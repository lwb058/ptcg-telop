/**
 * [INPUT]: node:test と実メッセージ経路を提供する state.test.helpers に依存する。
 * [OUTPUT]: 復元・履歴・操作適用をまたぐ実体識別の回帰を検証する。
 * [POS]: extension の状態テスト。公開メッセージと draft/live を通して誤対象更新を検出する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./state.test.helpers');

test('after persisted state reload, damage to newly placed B leaves A unchanged', async () => {
    const first = await createHarness();
    await first.place('slotL0');
    const originalId = first.get('live_slotL0').instanceId;
    const h = await createHarness(first.snapshot());
    await h.place('slotL1');
    await h.ui('SET_DAMAGE', { target: 'slotL1', value: 50 });
    await h.apply();
    assert.equal(h.get('live_slotL0').damage, 0);
    assert.equal(h.get('live_slotL1').damage, 50);
    assert.equal(h.get('live_slotL0').instanceId, originalId);
    assert.notEqual(h.get('live_slotL1').instanceId, originalId);
});

const setOp = (target, instanceId, index = 0) => ({
    type: 'SET_POKEMON', payload: { target, cardId: 'card1', ...(instanceId && { instanceId }) },
    id: `set-${target}`, priority: 1, queueIndex: index
});
const pack = (ops, timestamp = '00:00') => ({ id: `pack-${timestamp}`, timestamp, round: 1, ops });

for (const [message, value] of [['seekTimeline', 0], ['seekToTimestamp', '00:00']]) {
    test(`${message} retains legacy identity and allows a new independent instance`, async () => {
        const h = await createHarness();
        await h.request('importTimeline', JSON.stringify([pack([setOp('slotL0', 'L_001')])]));
        await h.request(message, value);
        await h.request(message, value);
        await h.ui('SET_POKEMON', { target: 'slotL8', cardId: 'card1' });
        await h.apply(true);
        await h.ui('SET_DAMAGE', { target: 'slotL8', value: 50 });
        await h.apply(true);
        assert.equal(h.get('live_slotL0').instanceId, 'L_001');
        assert.equal(h.get('live_slotL0').damage, 0);
        assert.equal(h.get('live_slotL8').damage, 50);
        assert.notEqual(h.get('live_slotL8').instanceId, 'L_001');
        const id = h.get('live_slotL8').instanceId;
        await h.request(message, value);
        assert.equal(h.get('live_slotL8').instanceId, id);
        assert.equal(h.get('live_slotL8').damage, 50);
    });
}

test('same card in both sides and extra bench slots receives independent identities', async () => {
    const h = await createHarness();
    const targets = ['slotL0', 'slotL1', 'slotL8', 'slotR0', 'slotR8'];
    for (const target of targets) await h.ui('SET_POKEMON', { target, cardId: 'card1' });
    const ids = targets.map(target => h.get(`draft_${target}`).instanceId);
    assert.equal(new Set(ids).size, targets.length);
    await h.apply();
    targets.forEach((target, i) => assert.equal(h.get(`live_${target}`).instanceId, ids[i]));
});

test('swap and evolution preserve the entity; removal and re-entry replace it', async () => {
    const h = await createHarness();
    await h.place('slotL0'); await h.place('slotL8', 'card2');
    const originalId = h.get('live_slotL0').instanceId;
    await h.ui('SWITCH_POKEMON', { source: 'slotL0', target: 'slotL8' });
    await h.ui('SET_DAMAGE', { target: 'slotL8', value: 50 });
    await h.apply();
    assert.equal(h.get('live_slotL8').instanceId, originalId);
    assert.equal(h.get('live_slotL8').damage, 50);
    assert.equal(h.get('live_slotL0').damage, 0);
    for (const actionType of ['Evolve', 'Devolve', 'Replace']) {
        await h.ui('REPLACE_POKEMON', { target: 'slotL8', cardId: 'card3', actionType });
        await h.apply();
        assert.equal(h.get('live_slotL8').instanceId, originalId);
        assert.equal(h.get('live_slotL8').damage, 50);
    }
    await h.ui('REMOVE_POKEMON', { target: 'slotL8', actionType: 'Remove' }); await h.apply();
    await h.place('slotL8');
    assert.notEqual(h.get('live_slotL8').instanceId, originalId);
    await h.request('queueOperation', { type: 'SET_DAMAGE', payload: { target: 'slotL8', instanceId: originalId, value: 150 } });
    await h.apply();
    assert.equal(h.get('live_slotL8').damage, 0);
});

test('legacy IDs, absent IDs and explicit old prize snapshots survive import/export', async () => {
    const h = await createHarness();
    const ops = [setOp('slotL0', 'L_001'), setOp('slotR8', null, 1),
        { type: 'REMOVE_POKEMON', payload: { target: 'slotL0', instanceId: 'L_001', actionType: 'KO' }, priority: 4, id: 'ko' },
        { type: 'SET_SIDES', payload: { target: 'sideR', value: 5 }, priority: 4, id: 'old-prize' }];
    await h.request('importTimeline', JSON.stringify([pack(ops)]));
    await h.request('seekTimeline', 0);
    assert.equal(h.get('live_sideR'), 5);
    assert.equal(h.get('draft_sideR'), 5);
    assert.equal(h.get('live_slotR8').cardId, 'card1');
    assert.equal(h.get('live_slotR8').instanceId, null);
    assert.deepEqual(JSON.parse(await h.request('exportTimeline')).timeline[0].ops, ops);
    assert.equal(h.get('operationQueue').length, 0);
});

async function corruptLayer(h, mode) {
    h.set(`${mode}_slotL8`, { ...h.get(`${mode}_slotL0`) });
    await h.flush();
}
for (const mode of ['draft', 'live']) {
    test(`an ambiguous ${mode} board rejects incoming operations before mutation`, async () => {
        const h = await createHarness(); await h.place('slotL0');
        await corruptLayer(h, mode);
        const before = h.snapshot();
        await assert.rejects(h.request('queueOperation', {
            type: 'SET_DAMAGE', payload: { target: 'slotL8', instanceId: h.get(`${mode}_slotL0`).instanceId, value: 50 }
        }), /duplicate|ambiguous/i);
        for (const key of ['operationQueue', 'live_slotL0', 'live_slotL8', 'draft_slotL0', 'draft_slotL8']) {
            assert.deepEqual(h.get(key), before[key]);
        }
    });
}

test('Apply rejects ambiguous identities before recording, removal animation or live mutation', async () => {
    const h = await createHarness(); await h.place('slotL0');
    await h.ui('REMOVE_POKEMON', { target: 'slotL0', actionType: 'KO' });
    await corruptLayer(h, 'live');
    const beforeQueue = h.get('operationQueue'); const beforeMessages = h.messages.length;
    h.set('matchTimer', { ...h.get('matchTimer'), mode: 'live' });
    await assert.rejects(h.request('applyOpsPack'), /duplicate|ambiguous/i);
    assert.deepEqual(h.get('operationQueue'), beforeQueue);
    assert.equal(h.get('processorStatus'), 'IDLE');
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    assert.equal(h.get('timelineGameplay').length, 0);
    assert.equal(h.messages.slice(beforeMessages).filter(m => m.name === 'playAnimation').length, 0);
});

for (const [message, value] of [['seekTimeline', 0], ['seekToTimestamp', '00:00']]) {
    test(`${message} rejects a corrupt historical pack before applying it`, async () => {
        const h = await createHarness();
        const history = [pack([setOp('slotL0', 'L_001'), setOp('slotL8', 'L_001', 1)])];
        await h.request('importTimeline', JSON.stringify(history));
        await assert.rejects(h.request(message, value), /duplicate|ambiguous/i);
        assert.deepEqual(h.get('timelineGameplay'), history);
        assert.equal(h.get('live_slotL0').cardId, null);
        assert.equal(h.get('live_slotL8').cardId, null);
        assert.equal(h.get('playbackStatus').isPlaying, false);
        assert.equal(h.get('processorStatus'), 'IDLE');
    });
}

test('editing a queued placement cannot introduce an ambiguous identity', async () => {
    const h = await createHarness(); await h.place('slotL0');
    await h.ui('SET_POKEMON', { target: 'slotL8', cardId: 'card1' });
    const before = h.snapshot();
    await assert.rejects(h.request('updateOperation', { index: 0, payload: { instanceId: h.get('live_slotL0').instanceId } }), /duplicate|ambiguous/i);
    assert.deepEqual(h.get('operationQueue'), before.operationQueue);
    assert.deepEqual(h.get('draft_slotL8'), before.draft_slotL8);
});

test('corrupt playback stops before animation and permits a later valid playback', async () => {
    const h = await createHarness();
    const history = [pack([setOp('slotL0', 'L_001'), setOp('slotL8', 'L_001', 1)])];
    await h.request('importTimeline', JSON.stringify(history));
    const offset = h.messages.length;
    await h.request('playTimeline');
    await h.advance(100);
    assert.equal(h.get('playbackStatus').isPlaying, false);
    assert.equal(h.get('matchTimer').isRunning, false);
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.messages.slice(offset).filter(m => m.name === 'playAnimation').length, 0);
    assert.ok(h.logs.some(entry => entry.level === 'error' && String(entry.args[0]).includes('DUPLICATE_INSTANCE_ID')));
    await h.request('importTimeline', JSON.stringify([pack([setOp('slotR0', 'R_001')])]));
    await h.request('playTimeline');
    await h.advance(100);
    assert.equal(h.get('live_slotR0').instanceId, 'R_001');
    await h.advance(3000);
});

test('mid-Apply identity conflict returns unexecuted operations and preserves action grouping', async () => {
    const h = await createHarness(); await h.place('slotR0');
    await h.ui('SET_POKEMON', { target: 'slotL0', cardId: 'card1' });
    await h.ui('REMOVE_POKEMON', { target: 'slotR0', actionType: 'KO' });
    await h.request('applyQueue');
    assert.equal(h.get('processorStatus'), 'PROCESSING');
    await h.ui('SET_ACTION_STATUS', { target: 'action_energy_L', status: true });
    await corruptLayer(h, 'live');
    const offset = h.messages.length;
    await h.request('animationBatchComplete');
    assert.equal(h.get('processorStatus'), 'IDLE');
    assert.equal(h.get('live_slotR0').cardId, 'card1');
    assert.equal(h.messages.slice(offset).filter(m => m.name === 'playAnimation').length, 0);
    const queue = h.get('operationQueue');
    assert.deepEqual(queue.map(op => op.type), ['REMOVE_POKEMON', 'SET_SIDES', 'SET_ACTION_STATUS']);
    assert.equal(queue[0].queueIndex, queue[1].queueIndex);
    assert.ok(queue[2].queueIndex > queue[1].queueIndex);
    assert.deepEqual(queue.map(op => op.priority), [4, 5, 2]);
});

test('an empty slot retaining a duplicate ID cannot intercept an occupied slot operation', async () => {
    const h = await createHarness(); await h.place('slotL8');
    const id = h.get('live_slotL8').instanceId;
    for (const mode of ['draft', 'live']) {
        h.set(`${mode}_slotL0`, { ...h.get(`${mode}_slotL0`), instanceId: id });
    }
    await h.flush();
    await assert.rejects(h.request('queueOperation', {
        type: 'SET_DAMAGE', payload: { target: 'slotL8', instanceId: id, value: 50 }
    }), /duplicate|ambiguous/i);
    assert.equal(h.get('operationQueue').length, 0);
    assert.equal(h.get('live_slotL0').damage, 0);
    assert.equal(h.get('live_slotL8').damage, 0);
});

test('mixed legacy IDs, new UUIDs and old prize snapshots round-trip without renumbering', async () => {
    const h = await createHarness(); await h.place('slotR8');
    const newId = h.get('live_slotR8').instanceId;
    const history = [pack([setOp('slotL0', 'L_001'), setOp('slotR8', newId, 1),
        { type: 'SET_SIDES', payload: { target: 'sideL', value: 4 }, priority: 4, id: 'old-prize' }])];
    await h.request('importTimeline', JSON.stringify(history));
    const exported = await h.request('exportTimeline');
    const restored = await createHarness();
    await restored.request('importTimeline', exported);
    await restored.request('seekTimeline', 0);
    assert.equal(restored.get('live_slotL0').instanceId, 'L_001');
    assert.equal(restored.get('live_slotR8').instanceId, newId);
    assert.equal(restored.get('live_sideL'), 4);
    assert.deepEqual(JSON.parse(await restored.request('exportTimeline')).timeline, history);
});
