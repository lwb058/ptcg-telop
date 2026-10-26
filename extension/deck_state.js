/**
 * [INPUT]: 取得済みカード ID 一覧と任意の枚数表、既存デッキ状態に依存する。共有カード DB は参照しない。
 * [OUTPUT]: createImportedDeck と addDeckCards が ID 索引とデッキ固有の counts を一緒に構築する。
 * [POS]: extension のデッキ状態境界。JP/CHT の明示枚数と CHS の繰り返し ID を統一し、単カード追加で既知枚数を保護する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';

function countOccurrences(cards) {
    const counts = new Map();
    for (const id of cards) counts.set(id, (counts.get(id) || 0) + 1);
    return Object.fromEntries(counts);
}

function createImportedDeck(name, cards, counts) {
    if (!Array.isArray(cards) || cards.some(id => typeof id !== 'string' || !id)) {
        throw new Error('Python did not return a valid card ID list.');
    }
    const ids = [...new Set(cards)];
    if (counts === undefined) counts = countOccurrences(cards);
    if (!counts || typeof counts !== 'object' || Array.isArray(counts) ||
        Object.keys(counts).length !== ids.length || ids.some(id => !Object.hasOwn(counts, id) ||
            !Number.isSafeInteger(counts[id]) || counts[id] <= 0)) {
        throw new Error('Python returned invalid card counts.');
    }
    return { name, cards: ids, counts: Object.fromEntries(ids.map(id => [id, counts[id]])) };
}

function addDeckCards(deck, cards) {
    const oldCards = Array.isArray(deck.cards) ? deck.cards : [];
    const added = [...new Set(cards)].filter(id => !oldCards.includes(id));
    if (!added.length) return deck;
    // 旧デッキの一意 ID は枚数不明。繰り返し ID だけは保存済みの証拠として引き継ぐ。
    const knownCounts = Object.fromEntries(Object.entries(countOccurrences(oldCards)).filter(([, count]) => count > 1));
    const savedCounts = Object.fromEntries(Object.entries(deck.counts || {}).filter(([id, count]) =>
        oldCards.includes(id) && Number.isSafeInteger(count) && count > 0));
    const counts = { ...knownCounts, ...savedCounts, ...Object.fromEntries(added.map(id => [id, 1])) };
    return { ...deck, cards: [...new Set([...oldCards, ...added])], counts };
}

module.exports = { createImportedDeck, addDeckCards };
