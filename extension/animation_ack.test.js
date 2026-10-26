/**
 * [INPUT]: node:test と実メッセージ経路を提供する state.test.helpers に依存する。
 * [OUTPUT]: 実行中の演出批次だけが完了し、旧通知・取消済み時計が次の操作を進めないことを検証する。
 * [POS]: extension の ACK プロトコル回帰。公開メッセージと live の結果を観測する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./state.test.helpers');

const latestBatch = h => h.messages.findLast(message => message.name === 'animationBatchStart')?.data;
const starts = h => h.messages.filter(message => message.name === 'animationBatchStart').map(message => message.data);
const ack = (h, batch, graphic = 'main') => h.request('animationBatchComplete', { batchId: batch.batchId, graphic });

async function damageThenSwitch() {
    const h = await createHarness();
    await h.place('slotL0', 'card1');
    await h.place('slotL1', 'card2');
    await h.ui('SET_DAMAGE', { target: 'slotL0', value: 50 });
    await h.ui('SWITCH_POKEMON', { source: 'slotL0', target: 'slotL1' });
    await h.request('applyQueue');
    return h;
}

test('duplicate ACK from the damage batch cannot finish the following slide-out', async () => {
    const h = await damageThenSwitch();
    const damageId = latestBatch(h).batchId;
    await h.request('animationBatchComplete', { batchId: damageId, graphic: 'main' });
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    await h.request('animationBatchComplete', { batchId: damageId, graphic: 'main' });
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
});

test('late damage ACK after its timeout cannot finish the following slide-out', async () => {
    const h = await damageThenSwitch();
    const damageId = latestBatch(h).batchId;
    await h.advance(10000);
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    await h.request('animationBatchComplete', { batchId: damageId, graphic: 'main' });
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
});

test('one Apply gives damage, slide-out, and slide-in independent runtime identities', async () => {
    const h = await damageThenSwitch();
    const damage = latestBatch(h);
    await ack(h, damage);
    const slideOut = latestBatch(h);
    await ack(h, slideOut);
    const slideIn = latestBatch(h);
    assert.equal(new Set([damage.batchId, slideOut.batchId, slideIn.batchId]).size, 3);
    assert.equal(h.get('live_slotL0').cardId, 'card2');
    assert.equal(h.get('live_slotL1').damage, 50);
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await ack(h, slideIn);
    assert.equal(h.get('processorStatus'), 'IDLE');
    assert.deepEqual(h.get('operationQueue'), []);
});

test('same base priority in different epochs does not accept the earlier placement ACK', async () => {
    const h = await createHarness();
    await h.ui('SET_POKEMON', { target: 'slotL0', cardId: 'card1' });
    await h.ui('SET_ACTION_STATUS', { target: 'action_energy_L', status: true });
    await h.ui('SET_POKEMON', { target: 'slotL1', cardId: 'card2' });
    await h.ui('SET_ACTION_STATUS', { target: 'action_supporter_L', status: true });
    await h.ui('SET_POKEMON', { target: 'slotL2', cardId: 'card3' });
    await h.request('applyQueue');
    const first = latestBatch(h);
    await ack(h, first);
    const second = latestBatch(h);
    assert.notEqual(first.batchId, second.batchId);
    assert.equal(h.get('live_slotL1').cardId, 'card2');
    assert.equal(h.get('live_slotL2').cardId, null);
    await ack(h, first);
    assert.equal(h.get('live_slotL2').cardId, null);
    assert.equal(latestBatch(h).batchId, second.batchId);
    await ack(h, second);
    assert.equal(h.get('live_slotL2').cardId, 'card3');
    await h.apply();
});

test('missing identity, wrong identity, and unrelated graphic cannot complete or clear the timeout', async () => {
    const h = await damageThenSwitch();
    const current = latestBatch(h);
    const count = starts(h).length;
    for (const data of [null, {}, { graphic: 'main' }, { batchId: 'wrong', graphic: 'main' },
        { batchId: current.batchId, graphic: 'extra' }, { batchId: current.batchId, graphic: 'unknown' },
        { batchId: current.batchId }]) {
        await h.request('animationBatchComplete', data);
        assert.equal(starts(h).length, count);
        assert.equal(h.get('processorStatus'), 'PROCESSING');
        assert.equal(h.get('live_slotL0').cardId, 'card1');
    }
    await h.advance(10000);
    assert.equal(starts(h).length, count + 1);
    assert.notEqual(latestBatch(h).batchId, current.batchId);
    assert.equal(h.get('live_slotL0').cardId, 'card1');
});

test('mixed main and extra placement waits once for each required graphic', async () => {
    const h = await createHarness();
    await h.ui('SET_POKEMON', { target: 'slotL0', cardId: 'card1' });
    await h.ui('SET_POKEMON', { target: 'slotR8', cardId: 'card2' });
    await h.request('applyQueue');
    const batch = latestBatch(h);
    assert.deepEqual(batch.graphics, ['main', 'extra']);
    await ack(h, batch, 'main');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await ack(h, batch, 'main');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await ack(h, batch, 'extra');
    assert.equal(h.get('processorStatus'), 'IDLE');
});

test('extra-only placement cannot be completed by a main preview window', async () => {
    const h = await createHarness();
    await h.ui('SET_POKEMON', { target: 'slotR6', cardId: 'card1' });
    await h.request('applyQueue');
    const batch = latestBatch(h);
    assert.deepEqual(batch.graphics, ['extra']);
    await ack(h, batch, 'main');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await ack(h, batch, 'extra');
    assert.equal(h.get('processorStatus'), 'IDLE');
});

test('switch between main and extra waits for both slide-out and slide-in graphics', async () => {
    const h = await createHarness();
    await h.place('slotL0', 'card1');
    await h.place('slotL6', 'card2');
    await h.ui('SWITCH_POKEMON', { source: 'slotL0', target: 'slotL6' });
    await h.request('applyQueue');
    const slideOut = latestBatch(h);
    assert.deepEqual(slideOut.graphics, ['main', 'extra']);
    await ack(h, slideOut, 'main');
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    await ack(h, slideOut, 'extra');
    const slideIn = latestBatch(h);
    assert.notEqual(slideIn.batchId, slideOut.batchId);
    assert.deepEqual(slideIn.graphics, ['main', 'extra']);
    assert.equal(h.get('live_slotL0').cardId, 'card2');
    await ack(h, slideIn, 'extra');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await ack(h, slideIn, 'main');
    assert.equal(h.get('processorStatus'), 'IDLE');
});

test('attack targeting extra requires the main move banner and extra hit effects', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.place('slotR8');
    await h.ui('ATTACK', { attackerSlotId: 'slotL0', attackName: 'Fixture attack', target: 'slotR8', damage: 40 });
    await h.request('applyQueue');
    const batch = latestBatch(h);
    assert.deepEqual(batch.graphics, ['main', 'extra']);
    assert.equal(h.get('live_slotR8').damage, 40);
    await ack(h, batch, 'main');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await ack(h, batch, 'extra');
    assert.equal(h.get('processorStatus'), 'IDLE');
});

test('animation routing follows a moved instance instead of its stale queued slot', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.ui('SET_DAMAGE', { target: 'slotL0', value: 40 });
    const moved = h.get('live_slotL0');
    h.set('live_slotL0', { ...moved, cardId: null, instanceId: null });
    h.set('live_slotL8', moved);
    await h.flush();
    await h.request('applyQueue');
    assert.deepEqual(latestBatch(h).graphics, ['extra']);
    assert.equal(h.get('live_slotL8').damage, 40);
    await ack(h, latestBatch(h), 'extra');
    assert.equal(h.get('processorStatus'), 'IDLE');
});

test('a vanished animation target has no graphic responder and still completes through its timeout', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.ui('SET_DAMAGE', { target: 'slotL0', value: 40 });
    h.set('live_slotL0', { ...h.get('live_slotL0'), cardId: null, instanceId: null });
    await h.flush();
    await h.request('applyQueue');
    const batch = latestBatch(h);
    assert.deepEqual(batch.graphics, []);
    await ack(h, batch, 'main');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await h.advance(10000);
    assert.equal(h.get('processorStatus'), 'IDLE');
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.get('live_slotL0').damage, 0);
});

for (const [message, data] of [['resetSystem', undefined], ['reStart', undefined], ['seekTimeline', 0], ['seekToTimestamp', '00:00']]) {
    test(`${message} cancels pending operations so old ACK and timeout cannot write them back`, async () => {
        const h = await createHarness();
        if (message.startsWith('seek')) {
            await h.request('importTimeline', JSON.stringify([{ id: 'history', timestamp: '00:00', round: 1, ops: [{
                type: 'SET_POKEMON', payload: { target: 'slotR0', cardId: 'card3', instanceId: 'R_legacy' },
                priority: 1, queueIndex: 0, id: 'history-set'
            }] }]));
        }
        await h.ui('SET_POKEMON', { target: 'slotL0', cardId: 'card1' });
        await h.ui('SET_TURN', { side: 'R' });
        await h.ui('SET_POKEMON', { target: 'slotL1', cardId: 'card2' });
        await h.request('applyQueue');
        const cancelled = latestBatch(h);
        await h.request(message, data);
        assert.equal(h.get('processorStatus'), 'IDLE');
        assert.ok(h.messages.some(event => event.name === 'animationBatchCancelled' && event.data.batchId === cancelled.batchId));
        await ack(h, cancelled);
        await h.advance(10000);
        assert.equal(h.get('live_slotL0').cardId, null);
        assert.equal(h.get('live_slotL1').cardId, null);
        assert.equal(h.get('live_currentTurn'), 'L');
        assert.equal(h.get('processorStatus'), 'IDLE');
        assert.equal(h.get('live_slotR0').cardId, message.startsWith('seek') ? 'card3' : null);
        await h.place('slotL2', 'card1');
        assert.equal(h.get('live_slotL2').cardId, 'card1');
    });
}

test('editing the waiting queue during Apply does not give it the running batch identity', async () => {
    const h = await createHarness();
    await h.ui('SET_POKEMON', { target: 'slotL0', cardId: 'card1' });
    await h.request('applyQueue');
    const applied = latestBatch(h);
    const count = starts(h).length;
    await h.ui('SET_POKEMON', { target: 'slotL1', cardId: 'card2' });
    assert.equal(starts(h).length, count);
    assert.equal(h.get('operationQueue').length, 1);
    assert.equal(h.get('operationQueue')[0].batchId, undefined);
    await ack(h, applied);
    assert.equal(h.get('live_slotL1').cardId, null);
    await h.request('applyQueue');
    assert.notEqual(latestBatch(h).batchId, applied.batchId);
    await h.apply();
    assert.equal(h.get('live_slotL1').cardId, 'card2');
});
