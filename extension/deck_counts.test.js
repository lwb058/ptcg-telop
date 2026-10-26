/**
 * [INPUT]: node:test、state.test.helpers の実 extension／timeline と制御可能な子プロセス境界に依存する。
 * [OUTPUT]: 各言語のデッキ枚数、左右独立、単カード追加・削除・リセット・再取得の保存契約を検証する。
 * [POS]: extension のデッキ数量回帰。メッセージから Replicant まで実コードを通し、外部通信とユーザーの保存状態は変更しない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHarness, cards } = require('./state.test.helpers');

async function importerHarness(language = 'jp', saved = {}) {
    const children = [];
    const spawn = (_command, args) => {
        const child = new EventEmitter();
        Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {}, args });
        children.push(child);
        return child;
    };
    const h = await createHarness({ 'ptcg-settings': { language }, ...saved },
        { databases: { chs: cards, cht: cards }, spawn });
    async function importDeck(side, code, output) {
        const request = h.beginRequest('importDeckOrCard', { side, code });
        await h.flush();
        const child = children.at(-1);
        const result = language === 'chs' ? { missingCards: [], missingImages: [], warnings: [],
            databaseSaved: true, status: 'success', ...output } : output;
        child.stdout.emit('data', Buffer.from(JSON.stringify(result)));
        child.emit('close', 0, null);
        await request.result;
        await h.flush();
    }
    return { h, children, importDeck };
}

for (const language of ['jp', 'cht']) {
    test(`${language} imports retain card counts separately for each player`, async () => {
        const { h, importDeck } = await importerHarness(language);
        await importDeck('L', 'left-deck', { cards: ['card1', 'card2'], counts: { card1: 4, card2: 12 } });
        await importDeck('R', 'right-deck', { cards: ['card1'], counts: { card1: 2 } });
        assert.deepEqual(h.get('deckL'), { name: 'left-deck', cards: ['card1', 'card2'], counts: { card1: 4, card2: 12 } });
        assert.deepEqual(h.get('deckR'), { name: 'right-deck', cards: ['card1'], counts: { card1: 2 } });
        assert.equal(h.get('cardDatabase').card1.counts, undefined);
        assert.equal(h.get('cardDatabase').card1.quantity, undefined);
    });
}

test('CHS occurrences become counts and single-card fallback does not erase them', async () => {
    const { h, children, importDeck } = await importerHarness('chs');
    await importDeck('L', 'left-deck', { cards: ['card1', 'card1', 'card1', 'card1', 'card2'] });
    assert.deepEqual(h.get('deckL'), { name: 'left-deck', cards: ['card1', 'card2'], counts: { card1: 4, card2: 1 } });
    const request = h.beginRequest('importDeckOrCard', { side: 'L', code: 'card3' });
    await h.flush();
    const deckAttempt = children.at(-1);
    deckAttempt.stdout.emit('data', Buffer.from('{}'));
    deckAttempt.emit('close', 1, null);
    await h.flush();
    assert.match(children.at(-1).args[0], /get_single_card_chs/);
    children.at(-1).stdout.emit('data', Buffer.from(JSON.stringify({ cards: ['card3'], missingCards: [],
        missingImages: [], warnings: [], databaseSaved: true, status: 'success' })));
    children.at(-1).emit('close', 0, null);
    await request.result;
    assert.deepEqual(h.get('deckL'), { name: 'left-deck', cards: ['card1', 'card2', 'card3'], counts: { card1: 4, card2: 1, card3: 1 } });
    assert.equal(h.get('deckIdL'), 'left-deck');
});

test('legacy cached single-card additions are idempotent and preserve imported counts', async () => {
    const { h, children, importDeck } = await importerHarness();
    await importDeck('L', 'left-deck', { cards: ['card1'], counts: { card1: 4 } });
    async function addCached(id) {
        const request = h.beginRequest('importDeckOrCard', { side: 'L', code: id });
        await h.flush();
        children.at(-1).emit('close', 1, null);
        await request.result;
        await h.flush();
    }
    await addCached('card2');
    await addCached('card1');
    await addCached('card2');
    assert.deepEqual(h.get('deckL'), { name: 'left-deck', cards: ['card1', 'card2'], counts: { card1: 4, card2: 1 } });
});

test('adding a card to an old deck does not invent quantities for old unique IDs', async () => {
    const { h, children } = await importerHarness('jp', { deckL: { name: 'old', cards: ['card1'] } });
    const request = h.beginRequest('importDeckOrCard', { side: 'L', code: 'card2' });
    await h.flush();
    children.at(-1).emit('close', 1, null);
    await request.result;
    assert.deepEqual(h.get('deckL'), { name: 'old', cards: ['card1', 'card2'], counts: { card2: 1 } });
});

test('saved counts survive extension restoration and a language reset clears both sides', async () => {
    const left = { name: 'saved-L', cards: ['card1'], counts: { card1: 4 } };
    const right = { name: 'saved-R', cards: ['card1'], counts: { card1: 2 } };
    const h = await createHarness({ deckL: left, deckR: right }, { databases: { chs: cards } });
    assert.deepEqual(h.get('deckL'), left);
    assert.deepEqual(h.get('deckR'), right);
    h.set('ptcg-settings', { ...h.get('ptcg-settings'), language: 'chs' });
    await h.flush();
    assert.deepEqual(h.get('deckL'), { name: '', cards: [] });
    assert.deepEqual(h.get('deckR'), { name: '', cards: [] });
});

test('legacy CHS repeated IDs keep their known counts when a new card is added', async () => {
    const { h, children } = await importerHarness('jp', { deckL: { name: 'old', cards: ['card1', 'card1', 'card1'] } });
    const request = h.beginRequest('importDeckOrCard', { side: 'L', code: 'card2' });
    await h.flush();
    children.at(-1).emit('close', 1, null);
    await request.result;
    assert.deepEqual(h.get('deckL'), { name: 'old', cards: ['card1', 'card2'], counts: { card1: 3, card2: 1 } });
});

test('removal drops the whole card entry and count; reimport and resets cannot retain stale counts', async () => {
    const { h, importDeck } = await importerHarness();
    await importDeck('L', 'first', { cards: ['card1', 'card2'], counts: { card1: 4, card2: 10 } });
    await h.request('removeCardFromDeck', { side: 'L', cardId: 'card1' });
    assert.deepEqual(h.get('deckL'), { name: 'first', cards: ['card2'], counts: { card2: 10 } });
    await importDeck('L', 'second', { cards: ['card3'], counts: { card3: 2 } });
    assert.deepEqual(h.get('deckL').counts, { card3: 2 });
    await h.request('restartGame');
    assert.deepEqual(h.get('deckL').counts, { card3: 2 });
    await h.request('resetSystem');
    assert.deepEqual(h.get('deckL'), { name: '', cards: [] });
});

test('invalid saved counts cannot erase the known occurrences of an old deck when adding a card', async () => {
    const { h, children } = await importerHarness('jp', {
        deckL: { name: 'old', cards: ['card1', 'card1'], counts: { card1: 0, removed: 9 } }
    });
    const request = h.beginRequest('importDeckOrCard', { side: 'L', code: 'card2' });
    await h.flush();
    children.at(-1).emit('close', 1, null);
    await request.result;
    assert.deepEqual(h.get('deckL'), { name: 'old', cards: ['card1', 'card2'], counts: { card1: 2, card2: 1 } });
});

test('invalid explicit counts reject the candidate without changing a loaded deck', async () => {
    for (const counts of [{ card1: 0 }, { card1: -1 }, { card1: 1.5 }, { card1: true }, {}, { card1: 2, card2: 3 }]) {
        const { h, children } = await importerHarness('jp', { deckL: { name: 'old', cards: ['card3'], counts: { card3: 4 } } });
        const request = h.beginRequest('importDeckOrCard', { side: 'L', code: 'new-deck' });
        await h.flush();
        children.at(-1).stdout.emit('data', Buffer.from(JSON.stringify({ cards: ['card1'], counts })));
        children.at(-1).emit('close', 0, null);
        await h.flush();
        if (/get_single_card/.test(children.at(-1).args[0])) children.at(-1).emit('close', 1, null);
        await assert.rejects(request.result);
        assert.deepEqual(h.get('deckL'), { name: 'old', cards: ['card3'], counts: { card3: 4 } });
    }
});

test('timeline deck reacquisition follows the same quantity import path', async () => {
    const { h, children } = await importerHarness();
    const request = h.beginRequest('importTimeline', JSON.stringify({ language: 'jp',
        deckL: { deckId: 'replay-L' }, timeline: [] }));
    await h.flush();
    children.at(-1).stdout.emit('data', Buffer.from(JSON.stringify({ cards: ['card1'], counts: { card1: 4 } })));
    children.at(-1).emit('close', 0, null);
    await request.result;
    assert.deepEqual(h.get('deckL'), { name: 'replay-L', cards: ['card1'], counts: { card1: 4 } });
});
