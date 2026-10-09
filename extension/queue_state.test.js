/**
 * [INPUT]: node:test と実メッセージ経路を提供する state.test.helpers に依存する。
 * [OUTPUT]: KO の独立賞罰操作と draft 再構築の回帰を検証する。
 * [POS]: extension の状態テスト。待機操作の編集から live・記録再構築までを観測する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./state.test.helpers');

test('KO followed by deleting ENERGY awards one prize through Apply', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    assert.equal(h.get('draft_sideR'), 5);
    await h.ui('SET_ACTION_STATUS', { target: 'action_energy_L', status: true });
    const energy = h.get('operationQueue').find(op => op.type === 'SET_ACTION_STATUS');
    await h.request('removeOperationById', energy.id);
    assert.equal(h.get('draft_sideR'), 5);
    assert.equal(h.get('operationQueue').filter(op => op.type === 'SET_SIDES').length, 1);
    await h.apply();
    assert.equal(h.get('live_sideR'), 5);
    assert.equal(h.get('draft_sideR'), 5);
});

test('manual Side correction after two KOs updates the latest award before a third KO', async () => {
    const h = await createHarness();
    for (const target of ['slotL0', 'slotL1', 'slotL2']) await h.place(target);
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    await h.ui('REMOVE_POKEMON', { target: 'slotL1', actionType: 'KO' });
    assert.equal(h.get('draft_sideR'), 4);
    await h.ui('SET_SIDES', { target: 'sideR', value: 3 }, true);
    assert.equal(h.get('draft_sideR'), 3);
    await h.ui('REMOVE_POKEMON', { target: 'slotL2', actionType: 'KO' });
    assert.equal(h.get('draft_sideR'), 2);
    await h.apply();
    assert.equal(h.get('live_sideR'), 2);
});

for (const side of ['L', 'R']) {
    for (const prize of [1, 2, 3]) {
        test(`${side} KO awards ${prize} prize(s) once through repeated ENERGY edits`, async () => {
            const h = await createHarness();
            const target = `slot${side}0`;
            const opposite = side === 'L' ? 'R' : 'L';
            await h.place(target, `card${prize}`);
            await h.ui('REMOVE_POKEMON', { target, actionType: 'KO' });
            const capturedQueue = h.get('operationQueue');
            await h.ui('SET_ACTION_STATUS', { target: `action_energy_${side}`, status: true });
            const index = h.get('operationQueue').findIndex(op => op.type === 'SET_ACTION_STATUS');
            for (const status of [false, true, false]) {
                await h.request('updateOperation', { index, payload: { status } });
                assert.equal(h.get(`draft_side${opposite}`), 6 - prize);
                assert.deepEqual(h.get('operationQueue').slice(0, 2), capturedQueue);
            }
            await h.apply();
            assert.equal(h.get(`live_side${opposite}`), 6 - prize);
            assert.equal(h.get(`live_side${side}`), 6);
            assert.equal(h.get(`live_${target}`).cardId, null);
        });
    }
}

test('three-prize KO clamps a one-prize remainder to zero after queue reconstruction', async () => {
    const h = await createHarness();
    await h.place('slotR8', 'card3');
    await h.ui('SET_SIDES', { target: 'sideL', value: 1 });
    await h.apply();
    await h.ui('REMOVE_POKEMON', { target: 'slotR8', actionType: 'KO' });
    await h.ui('SET_ACTION_STATUS', { target: 'action_energy_R', status: true });
    const energy = h.get('operationQueue').find(op => op.type === 'SET_ACTION_STATUS');
    await h.request('removeOperationById', energy.id);
    assert.equal(h.get('draft_sideL'), 0);
    await h.apply();
    assert.equal(h.get('live_sideL'), 0);
});

test('deleting the award leaves the KO and does not regenerate a prize operation', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    const award = h.get('operationQueue').find(op => op.type === 'SET_SIDES');
    await h.request('removeOperationById', award.id);
    assert.deepEqual(h.get('operationQueue').map(op => op.type), ['REMOVE_POKEMON']);
    assert.equal(h.get('draft_sideR'), 6);
    assert.equal(h.get('draft_slotL0').cardId, null);
    await h.apply();
    assert.equal(h.get('live_sideR'), 6);
    assert.equal(h.get('live_slotL0').cardId, null);
});

test('deleting the KO leaves its independently editable award', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    const original = h.get('live_slotL0');
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    const ko = h.get('operationQueue').find(op => op.type === 'REMOVE_POKEMON');
    await h.request('removeOperationById', ko.id);
    assert.deepEqual(h.get('operationQueue').map(op => op.type), ['SET_SIDES']);
    assert.deepEqual(h.get('draft_slotL0'), original);
    assert.equal(h.get('draft_sideR'), 5);
    await h.apply();
    assert.deepEqual(h.get('live_slotL0'), original);
    assert.equal(h.get('live_sideR'), 5);
});

test('deleting an earlier KO and award preserves a later captured absolute Side value', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.place('slotL1');
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    const firstIds = h.get('operationQueue').map(op => op.id);
    await h.ui('REMOVE_POKEMON', { target: 'slotL1', actionType: 'KO' });
    await h.request('removeOperationById', firstIds);
    assert.equal(h.get('draft_sideR'), 4);
    assert.equal(h.get('draft_slotL0').cardId, 'card1');
    await h.apply();
    assert.equal(h.get('live_sideR'), 4);
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    assert.equal(h.get('live_slotL1').cardId, null);
});

test('Discard restores the removed entity and Side without retaining generated operations', async () => {
    const h = await createHarness();
    await h.place('slotL0', 'card2');
    const original = h.get('live_slotL0');
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    await h.request('discardQueue');
    assert.deepEqual(h.get('operationQueue'), []);
    assert.deepEqual(h.get('draft_slotL0'), original);
    assert.equal(h.get('draft_sideR'), 6);
    await h.apply();
    assert.deepEqual(h.get('live_slotL0'), original);
    assert.equal(h.get('live_sideR'), 6);
});

for (const configuration of ['auto prize disabled', 'ordinary removal']) {
    test(`${configuration} never produces an automatic prize operation`, async () => {
        const h = await createHarness();
        if (configuration === 'auto prize disabled') {
            h.set('ptcg-settings', { ...h.get('ptcg-settings'), autoPrizeTake: false });
            await h.flush();
        }
        await h.place('slotL0', 'card3');
        await h.ui('REMOVE_POKEMON', {
            target: 'slotL0', actionType: configuration === 'ordinary removal' ? 'Remove' : 'KO'
        });
        assert.deepEqual(h.get('operationQueue').map(op => op.type), ['REMOVE_POKEMON']);
        assert.equal(h.get('draft_sideR'), 6);
        await h.apply();
        assert.equal(h.get('live_sideR'), 6);
        assert.equal(h.get('live_slotL0').cardId, null);
    });
}

test('empty-slot KO is rejected without queue or Side mutation', async () => {
    const h = await createHarness();
    const draft = h.get('draft_slotL0');
    await assert.rejects(h.request('queueOperation', {
        type: 'REMOVE_POKEMON', payload: { target: 'slotL0', actionType: 'KO' }
    }), /empty slot/);
    assert.deepEqual(h.get('operationQueue'), []);
    assert.deepEqual(h.get('draft_slotL0'), draft);
    assert.equal(h.get('draft_sideR'), 6);
});

test('stale-instance KO is rejected before overwriting the supplied identity or awarding prizes', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    const oldId = h.get('live_slotL0').instanceId;
    await h.place('slotL0', 'card3');
    const current = h.get('draft_slotL0');
    await assert.rejects(h.request('queueOperation', {
        type: 'REMOVE_POKEMON', payload: { target: 'slotL0', actionType: 'KO', instanceId: oldId }
    }), /stale instanceId/);
    assert.deepEqual(h.get('operationQueue'), []);
    assert.deepEqual(h.get('draft_slotL0'), current);
    assert.equal(h.get('draft_sideR'), 6);
});

for (const position of ['before', 'after']) {
    test(`manual Side correction ${position} a KO survives Apply ordering`, async () => {
        const h = await createHarness();
        await h.place('slotL0');
        if (position === 'before') await h.ui('SET_SIDES', { target: 'sideR', value: 3 }, true);
        await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
        if (position === 'after') await h.ui('SET_SIDES', { target: 'sideR', value: 3 }, true);
        const expected = position === 'before' ? 2 : 3;
        assert.equal(h.get('draft_sideR'), expected);
        await h.apply();
        assert.equal(h.get('live_sideR'), expected);
    });
}

test('KO and award share a queue epoch and the award waits for KO animation', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    await h.ui('SET_POKEMON', { target: 'slotL1', cardId: 'card1' });
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    const queue = h.get('operationQueue');
    const ko = queue.find(op => op.type === 'REMOVE_POKEMON');
    const award = queue.find(op => op.type === 'SET_SIDES');
    assert.ok(Number.isInteger(award.queueIndex));
    assert.equal(award.queueIndex, ko.queueIndex);
    assert.equal(award.priority, 5);
    assert.notEqual(award.id, ko.id);
    await h.request('applyQueue');
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    assert.equal(h.get('live_sideR'), 6);
    await h.request('animationBatchComplete');
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.get('live_sideR'), 6);
    await h.request('animationBatchComplete');
    assert.equal(h.get('live_sideR'), 5);
    assert.equal(h.get('processorStatus'), 'IDLE');
});

for (const seek of ['seekTimeline', 'seekToTimestamp']) {
    test(`recorded KO remains a single award across repeated ${seek}`, async () => {
        const h = await createHarness();
        await h.request('timerControl', { action: 'start' });
        await h.ui('SET_POKEMON', { target: 'slotR0', cardId: 'card2' });
        await h.apply(true);
        await h.ui('REMOVE_POKEMON', { target: 'slotR0', actionType: 'KO' });
        await h.ui('SET_ACTION_STATUS', { target: 'action_energy_R', status: true });
        const energy = h.get('operationQueue').find(op => op.type === 'SET_ACTION_STATUS');
        await h.request('removeOperationById', energy.id);
        const award = h.get('operationQueue').find(op => op.type === 'SET_SIDES');
        await h.apply(true);
        const packs = h.get('timelineGameplay');
        assert.equal(packs.length, 2);
        assert.equal(packs[1].ops.filter(op => op.type === 'SET_SIDES').length, 1);
        assert.deepEqual(packs[1].ops.find(op => op.type === 'SET_SIDES'), award);
        const position = seek === 'seekTimeline' ? packs.length - 1 : packs.at(-1).timestamp;
        for (let repeat = 0; repeat < 3; repeat++) {
            await h.request(seek, position);
            assert.equal(h.get('live_sideL'), 4);
            assert.equal(h.get('draft_sideL'), 4);
            assert.equal(h.get('live_slotR0').cardId, null);
            assert.deepEqual(h.get('operationQueue'), []);
            assert.deepEqual(h.get('timelineGameplay'), packs);
        }
    });
}

test('legacy KO history with priority 4 and no queueIndex retains its captured award', async () => {
    const h = await createHarness();
    const legacy = [{ id: 'old-pack', timestamp: '00:00', round: 0, ops: [
        { id: 'old-enter', type: 'SET_POKEMON', priority: 1, payload: { target: 'slotL0', cardId: 'card2', instanceId: 'L_001' } },
        { id: 'old-prize', type: 'SET_SIDES', priority: 4, payload: { target: 'sideR', value: 4 } },
        { id: 'old-ko', type: 'REMOVE_POKEMON', priority: 4, payload: { target: 'slotL0', actionType: 'KO', instanceId: 'L_001' } }
    ] }];
    await h.request('importTimeline', JSON.stringify(legacy));
    await h.request('seekTimeline', 0);
    assert.equal(h.get('live_sideR'), 4);
    assert.equal(h.get('draft_sideR'), 4);
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.deepEqual(h.get('operationQueue'), []);
    assert.deepEqual(h.get('timelineGameplay'), legacy);
});
