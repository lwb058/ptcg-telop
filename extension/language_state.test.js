/**
 * [INPUT]: node:test と実 extension・timeline を実行する state.test.helpers に依存する。
 * [OUTPUT]: 言語変更による DB の切替と現対局の完全リセット、初期復元の保護を検証する。
 * [POS]: extension の言語状態回帰。設定変更から公開 Replicant と非同期処理の結果を観測する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHarness, cards } = require('./state.test.helpers');

const chsCards = { card1: { name: '中文卡牌', card_type: 'Pokemon', image_ext: 'png', pokemon: { hp: 300, prize: 2, color: ['火'] } } };
const chtCards = { card1: { name: '繁體卡牌', card_type: 'Pokemon', image_ext: 'webp', pokemon: { hp: 250, prize: 3, color: ['水'] } } };
const changeLanguage = async (h, language) => {
    h.set('ptcg-settings', { ...h.get('ptcg-settings'), language });
    await h.flush();
};

test('changing language ends the current game and publishes the matching card database', async () => {
    const h = await createHarness({}, { databases: { chs: chsCards } });
    await h.place('slotL0');
    assert.equal(h.get('cardDatabase').card1.name, cards.card1.name);
    await changeLanguage(h, 'chs');
    assert.deepEqual(h.get('cardDatabase'), chsCards);
    assert.equal(h.get('language'), 'chs');
    assert.equal(h.get('assetPaths').cardImgPath, 'assets/ptcg-telop/card_img_chs/');
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.get('draft_slotL0').cardId, null);
});

test('language change uses Reset System for decks, IDs, prizes, history, timer, playback, and display', async () => {
    const h = await createHarness({}, { databases: { chs: chsCards } });
    h.set('ptcg-settings', { ...h.get('ptcg-settings'), lostZoneEnabled: true, toolLimit: 6 });
    await h.flush();
    await h.place('slotL0');
    await h.place('slotR8', 'card2');
    h.set('playerL_name', 'Alice');
    h.set('playerR_name', 'Bob');
    h.set('deckL', { name: 'JP left deck', cards: ['card1'] });
    h.set('deckR', { name: 'JP right deck', cards: ['card2'] });
    h.set('deckIdL', 'JP-L');
    h.set('deckIdR', 'JP-R');
    const prizes = Array.from({ length: 6 }, (_, index) => ({ cardId: 'card1', isTaken: index === 0 }));
    h.set('prizeCardsL', prizes);
    h.set('prizeCardsR', prizes);
    h.set('gameSetup', { firstMove: 'R', prizeCardsL: prizes, prizeCardsR: prizes });
    h.set('firstMove', 'R');
    h.set('cardToShowL', '/assets/ptcg-telop/card_img_jp/card1.jpg');
    h.set('cardToShowR', '/assets/ptcg-telop/card_img_jp/card2.jpg');
    h.set('timelineGameplay', [{ id: 'old-game', timestamp: '00:00', ops: [] }]);
    h.set('timelineDisplay', [{ id: 'old-display', timestamp: '00:00', type: 'SHOW_CARD', payload: {} }]);
    h.set('playbackStatus', { isPlaying: true, playbackTimeMs: 4000, currentIndexGameplay: 1, currentIndexDisplay: 1, currentTime: '00:04' });
    await h.request('timerControl', { action: 'start' });
    for (const side of ['L', 'R']) {
        h.set(`live_side${side}`, 2);
        h.set(`draft_side${side}`, 2);
        h.set(`live_lostZone${side}`, 9);
        h.set(`draft_lostZone${side}`, 9);
        h.set(`live_vstar_${side}`, true);
        h.set(`draft_vstar_${side}`, true);
        for (const action of ['energy', 'supporter', 'retreat']) {
            h.set(`live_action_${action}_${side}`, true);
            h.set(`draft_action_${action}_${side}`, true);
        }
    }
    h.set('live_stadium', { cardId: 'card1', used: true });
    h.set('draft_stadium', { cardId: 'card1', used: true });
    h.set('selections', ['slotL0']);
    await h.ui('SET_DAMAGE', { target: 'slotL0', value: 50 });
    await changeLanguage(h, 'chs');
    for (const side of ['L', 'R']) {
        assert.deepEqual(h.get(`deck${side}`), { name: '', cards: [] });
        assert.equal(h.get(`deckId${side}`), '');
        assert.deepEqual(h.get(`prizeCards${side}`), Array.from({ length: 6 }, () => ({ cardId: null, isTaken: false })));
        assert.equal(h.get(`cardToShow${side}`), '');
        for (const mode of ['live', 'draft']) {
            for (let index = 0; index < 9; index++) {
                assert.equal(h.get(`${mode}_slot${side}${index}`).cardId, null);
                assert.equal(h.get(`${mode}_slot${side}${index}`).instanceId, null);
            }
            assert.equal(h.get(`${mode}_side${side}`), 6);
            assert.equal(h.get(`${mode}_lostZone${side}`), 0);
            assert.equal(h.get(`${mode}_vstar_${side}`), false);
            for (const action of ['energy', 'supporter', 'retreat']) assert.equal(h.get(`${mode}_action_${action}_${side}`), false);
        }
    }
    assert.equal(h.get('gameSetup'), null);
    assert.deepEqual(h.get('selections'), []);
    assert.deepEqual(h.get('operationQueue'), []);
    assert.deepEqual(h.get('timelineGameplay'), []);
    assert.deepEqual(h.get('timelineDisplay'), []);
    assert.equal(h.get('live_stadium').cardId, null);
    assert.equal(h.get('draft_stadium').cardId, null);
    assert.equal(h.get('live_currentTurn'), 'L');
    assert.equal(h.get('draft_currentTurn'), 'L');
    assert.equal(h.get('turnCount'), 1);
    const timer = h.get('matchTimer');
    assert.deepEqual({ mode: timer.mode, offset: timer.offset, elapsed: timer.elapsed, isRunning: timer.isRunning, startTime: timer.startTime },
        { mode: 'standby', offset: 0, elapsed: 0, isRunning: false, startTime: null });
    assert.equal(h.get('playbackStatus').isPlaying, false);
    assert.equal(h.get('playbackStatus').playbackTimeMs, 0);
    assert.equal(h.get('processorStatus'), 'IDLE');
    assert.equal(h.get('playerL_name'), 'Alice');
    assert.equal(h.get('playerR_name'), 'Bob');
    assert.equal(h.get('ptcg-settings').toolLimit, 6);
    assert.deepEqual(h.get('cardDatabase'), chsCards);
});

test('initial startup loads the saved language while preserving a persisted current game', async () => {
    const before = await createHarness();
    await before.place('slotL0');
    before.set('deckL', { name: 'Restored deck', cards: ['card1'] });
    before.set('deckIdL', 'RESTORED-ID');
    before.set('timelineGameplay', [{ id: 'restored-history', timestamp: '00:00', ops: [] }]);
    before.set('matchTimer', { startTime: null, pausedTime: 0, isRunning: false, offset: 25000, mode: 'live', elapsed: 25000 });
    const saved = before.snapshot();
    saved['ptcg-settings'].language = 'chs';
    const h = await createHarness(saved, { databases: { chs: chsCards } });
    assert.deepEqual(h.get('cardDatabase'), chsCards);
    assert.equal(h.get('language'), 'chs');
    assert.equal(h.get('assetPaths').cardImgPath, 'assets/ptcg-telop/card_img_chs/');
    assert.deepEqual(h.get('live_slotL0'), saved.live_slotL0);
    assert.deepEqual(h.get('deckL'), saved.deckL);
    assert.equal(h.get('deckIdL'), 'RESTORED-ID');
    assert.deepEqual(h.get('timelineGameplay'), saved.timelineGameplay);
    assert.equal(h.get('matchTimer').offset, 25000);
});

test('saving the same language or unrelated settings preserves the game and does not reload the DB', async () => {
    const h = await createHarness();
    await h.place('slotL0');
    const oldSlot = h.get('live_slotL0');
    h.setDatabase('jp', { card1: { ...cards.card1, name: 'Changed on disk' } });
    h.set('ptcg-settings', { ...h.get('ptcg-settings') });
    await h.flush();
    assert.deepEqual(h.get('live_slotL0'), oldSlot);
    assert.deepEqual(h.get('cardDatabase'), cards);
    h.set('ptcg-settings', { ...h.get('ptcg-settings'), toolLimit: 5 });
    await h.flush();
    assert.deepEqual(h.get('live_slotL0'), oldSlot);
    assert.deepEqual(h.get('cardDatabase'), cards);
});

test('each actual language change publishes its own names, metadata, and image path', async () => {
    const h = await createHarness({}, { databases: { chs: chsCards, cht: chtCards } });
    for (const [language, database] of [['chs', chsCards], ['cht', chtCards], ['jp', cards]]) {
        await changeLanguage(h, language);
        assert.deepEqual(h.get('cardDatabase'), database);
        assert.equal(h.get('language'), language);
        assert.equal(h.get('assetPaths').cardImgPath, `assets/ptcg-telop/card_img_${language}/`);
        await h.place('slotL0');
    }
});

for (const [description, database] of [['missing', undefined], ['empty file', ''], ['invalid JSON', '{bad'],
    ['array', []], ['null', null], ['primitive', 3]]) {
    test(`${description} new-language DB clears old data and leaves a clean game`, async () => {
        const h = await createHarness({}, { databases: { chs: database } });
        await h.place('slotL0');
        await changeLanguage(h, 'chs');
        assert.deepEqual(h.get('cardDatabase'), {});
        assert.equal(h.get('live_slotL0').cardId, null);
        assert.equal(h.get('language'), 'chs');
        assert.equal(h.get('assetPaths').cardImgPath, 'assets/ptcg-telop/card_img_chs/');
        assert.ok(h.logs.some(log => log.level === 'warn' || log.level === 'error'));
    });
}

test('language reset cancels a pending batch so old ACK and timeout cannot repopulate the new game', async () => {
    const h = await createHarness({}, { databases: { chs: chsCards } });
    await h.ui('SET_POKEMON', { target: 'slotL0', cardId: 'card1' });
    await h.ui('SET_TURN', { side: 'R' });
    await h.ui('SET_POKEMON', { target: 'slotL1', cardId: 'card2' });
    await h.request('applyQueue');
    const batch = h.messages.findLast(message => message.name === 'animationBatchStart').data;
    await changeLanguage(h, 'chs');
    await h.request('animationBatchComplete', { batchId: batch.batchId, graphic: 'main' });
    await h.advance(10000);
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.get('live_slotL1').cardId, null);
    assert.equal(h.get('live_currentTurn'), 'L');
    assert.equal(h.get('turnCount'), 1);
    assert.equal(h.get('processorStatus'), 'IDLE');
    assert.deepEqual(h.get('cardDatabase'), chsCards);
    await h.place('slotL2');
    assert.equal(h.get('live_slotL2').cardId, 'card1');
});

test('language reset cancels an actual playback animation delay before old later operations', async () => {
    const h = await createHarness({}, { databases: { chs: chsCards } });
    const history = [{ id: 'playback-pack', timestamp: '00:00', round: 1, ops: [
        { type: 'SET_POKEMON', payload: { target: 'slotL0', cardId: 'card1', instanceId: 'L_playback_A' }, priority: 1, queueIndex: 0, id: 'place-A' },
        { type: 'SET_TURN', payload: { side: 'R' }, priority: 1, queueIndex: 1, id: 'old-turn' },
        { type: 'SET_POKEMON', payload: { target: 'slotL1', cardId: 'card2', instanceId: 'L_playback_B' }, priority: 1, queueIndex: 2, id: 'place-B' }
    ] }];
    await h.request('importTimeline', JSON.stringify(history));
    await h.request('playTimeline');
    await h.advance(100);
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    assert.equal(h.get('live_slotL1').cardId, null);
    await changeLanguage(h, 'chs');
    await h.advance(10000);
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.get('live_slotL1').cardId, null);
    assert.equal(h.get('live_currentTurn'), 'L');
    assert.deepEqual(h.get('timelineGameplay'), []);
    assert.equal(h.get('playbackStatus').isPlaying, false);
    assert.equal(h.get('matchTimer').mode, 'standby');
    const fresh = [{ id: 'fresh-pack', timestamp: '00:00', round: 1, ops: [{
        type: 'SET_POKEMON', payload: { target: 'slotR8', cardId: 'card1', instanceId: 'R_new_language' }, priority: 1, queueIndex: 0, id: 'fresh-place'
    }] }];
    await h.request('importTimeline', JSON.stringify(fresh));
    await h.request('playTimeline');
    await h.advance(100);
    assert.equal(h.get('live_slotR8').instanceId, 'R_new_language');
    await h.advance(10000);
    assert.equal(h.get('live_slotL1').cardId, null);
});

test('natural playback waits for the last pack animations and prize settlement before stopping', async () => {
    const h = await createHarness();
    const history = [{ id: 'last-pack', timestamp: '00:00', round: 1, ops: [
        { type: 'SET_POKEMON', payload: { target: 'slotL0', cardId: 'card1', instanceId: 'L_last_pack' }, priority: 1, queueIndex: 0, id: 'last-place' },
        { type: 'SET_DAMAGE', payload: { target: 'slotL0', instanceId: 'L_last_pack', value: 200 }, priority: 3, queueIndex: 1, id: 'last-damage' },
        { type: 'REMOVE_POKEMON', payload: { target: 'slotL0', instanceId: 'L_last_pack', actionType: 'KO' }, priority: 4, queueIndex: 2, id: 'last-ko' },
        { type: 'SET_SIDES', payload: { target: 'sideR', value: 5 }, priority: 5, queueIndex: 2, id: 'last-prize' }
    ] }];
    await h.request('importTimeline', JSON.stringify(history));
    await h.request('playTimeline');
    await h.advance(100);
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    await h.advance(2500);
    assert.equal(h.get('live_slotL0').damage, 200);
    await h.advance(600);
    assert.equal(h.get('playbackStatus').isPlaying, true);
    await h.advance(20000);
    assert.equal(h.get('live_slotL0').cardId, null);
    await h.advance(3000);
    await h.advance(100);
    assert.equal(h.get('live_sideR'), 5);
    assert.equal(h.get('draft_sideR'), 5);
    assert.equal(h.get('playbackStatus').isPlaying, false);
    assert.equal(h.get('matchTimer').isRunning, false);
});

test('paused playback preserves the active pack and resumes its remaining operations', async () => {
    const h = await createHarness();
    const history = [{ id: 'paused-pack', timestamp: '00:00', round: 1, ops: [
        { type: 'SET_POKEMON', payload: { target: 'slotL0', cardId: 'card1', instanceId: 'L_pause' }, priority: 1, queueIndex: 0, id: 'pause-place' },
        { type: 'SET_DAMAGE', payload: { target: 'slotL0', instanceId: 'L_pause', value: 30 }, priority: 3, queueIndex: 1, id: 'pause-damage' }
    ] }];
    await h.request('importTimeline', JSON.stringify(history));
    await h.request('playTimeline');
    await h.advance(100);
    assert.equal(h.get('live_slotL0').cardId, 'card1');
    await h.request('pauseTimeline');
    await h.advance(20000);
    assert.equal(h.get('live_slotL0').damage, 0);
    assert.equal(h.get('playbackStatus').isPlaying, false);
    await h.request('resumeTimeline');
    assert.equal(h.get('live_slotL0').damage, 30);
    await h.advance(20000);
    await h.advance(100);
    assert.equal(h.get('playbackStatus').isPlaying, false);
    assert.equal(h.get('draft_slotL0').damage, 30);
});

test('language reset releases a paused playback worker without applying its remainder', async () => {
    const h = await createHarness({}, { databases: { chs: chsCards } });
    const history = [{ id: 'cancel-paused', timestamp: '00:00', round: 1, ops: [
        { type: 'SET_POKEMON', payload: { target: 'slotL0', cardId: 'card1', instanceId: 'L_paused_old' }, priority: 1, queueIndex: 0, id: 'old-place' },
        { type: 'SET_POKEMON', payload: { target: 'slotL1', cardId: 'card2', instanceId: 'L_paused_later' }, priority: 1, queueIndex: 2, id: 'old-later' },
        { type: 'SET_TURN', payload: { side: 'R' }, priority: 1, queueIndex: 1, id: 'old-fence' }
    ] }];
    await h.request('importTimeline', JSON.stringify(history));
    await h.request('playTimeline');
    await h.advance(100);
    await h.request('pauseTimeline');
    await h.advance(20000);
    assert.equal(h.get('live_slotL1').cardId, null);
    await changeLanguage(h, 'chs');
    await h.advance(20000);
    assert.equal(h.get('live_slotL0').cardId, null);
    assert.equal(h.get('live_slotL1').cardId, null);
    assert.equal(h.get('live_currentTurn'), 'L');
    assert.equal(h.get('matchTimer').mode, 'standby');
    assert.equal(h.get('playbackStatus').isPlaying, false);
});

test('expired timeline deck import stops before Deck R and cannot overwrite a new import after language returns', async () => {
    const children = [];
    const spawn = (_command, args) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        child.args = args;
        children.push(child);
        return child;
    };
    const h = await createHarness({}, { databases: { chs: chsCards }, spawn });
    h.set('playerL_name', 'Current Alice');
    const old = h.beginRequest('importTimeline', JSON.stringify({ language: 'jp',
        deckL: { deckId: 'OLD-L', playerName: 'Old Alice' }, deckR: { deckId: 'OLD-R', playerName: 'Old Bob' },
        timeline: [{ id: 'old-history', timestamp: '00:00', ops: [] }],
        timelineDisplay: [{ id: 'old-display', timestamp: '00:00', type: 'HIDE_DISPLAY', payload: {} }],
        gameSetup: { firstMove: 'R', prizeCardsL: [{ cardId: 'card2', isTaken: false }] }
    }));
    await h.flush();
    assert.equal(children.length, 1);
    await changeLanguage(h, 'chs');
    await changeLanguage(h, 'jp');
    const freshHistory = [{ id: 'fresh-history', timestamp: '00:00', ops: [] }];
    const fresh = h.beginRequest('importTimeline', JSON.stringify({ language: 'jp', deckL: { deckId: 'FRESH-L' }, timeline: freshHistory }));
    await h.flush();
    assert.equal(children.length, 2);
    assert.equal(h.get('deckLoadingStatus').loading, true);
    children[0].stdout.emit('data', Buffer.from(JSON.stringify({ cards: ['card2'] })));
    children[0].emit('close', 0, null);
    await h.flush();
    await assert.rejects(old.result, error => error.code === 'IMPORT_CONTEXT_EXPIRED');
    assert.equal(children.length, 2);
    assert.equal(h.get('deckLoadingStatus').loading, true);
    assert.deepEqual(h.get('deckL'), { name: '', cards: [] });
    assert.deepEqual(h.get('deckR'), { name: '', cards: [] });
    assert.deepEqual(h.get('timelineGameplay'), []);
    assert.deepEqual(h.get('timelineDisplay'), []);
    assert.equal(h.get('gameSetup'), null);
    assert.equal(h.get('playerL_name'), 'Current Alice');
    children[1].stdout.emit('data', Buffer.from(JSON.stringify({ cards: ['card1'] })));
    children[1].emit('close', 0, null);
    await fresh.result;
    await h.flush();
    assert.deepEqual(h.get('deckL'), { name: 'FRESH-L', cards: ['card1'], counts: { card1: 1 } });
    assert.deepEqual(h.get('timelineGameplay'), freshHistory);
    assert.equal(h.get('deckLoadingStatus').loading, false);
});
