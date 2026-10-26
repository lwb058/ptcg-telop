/**
 * [INPUT]: Node.js の test・assert・VM API、Deck Viewer の実 HTML と四言語辞書に依存する。
 * [OUTPUT]: 保存枚数・旧データの不明表示・左右の独立更新と、一覧／Grid の表示・クリック・ドラッグ・削除契約を検証する。
 * [POS]: extension の dashboard 契約テスト。HTML のインライン処理を隔離 DOM と Replicant 上で実行し、ユーザーのデッキや外部 API を変更しない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dashboard/deck_viewer.html'), 'utf8');
const strings = JSON.parse(fs.readFileSync(path.join(root, 'i18n/strings.json'), 'utf8'));
const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(source => source.trim());

// ---- 実ページが使用する DOM の木・クラス・イベント境界 ----
class Element {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.listeners = {};
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name)
        };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { this.markup = value; this.text = ''; this.children = []; }
    get innerHTML() { return this.markup || ''; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    emit(name, detail = {}) {
        const event = { target: this, currentTarget: this, preventDefault() {}, ...detail };
        this[`on${name}`]?.(event);
        for (const callback of this.listeners[name] || []) callback(event);
    }
    click() { this.emit('click'); }
    closest(selector) {
        if (matches(this, selector)) return this;
        return this.parentElement?.closest(selector) || null;
    }
}

function matches(node, selector) {
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    if (!classes.every(name => node.classList.contains(name))) return false;
    const player = selector.match(/\[data-player="([LR])"\]/)?.[1];
    return !player || node.dataset.player === player;
}

const db = {
    pokemonA: { name: 'ポケモン A', supertype: 'pokemon', pokemon: { color: ['草'] } },
    pokemonB: { name: 'ポケモン B', supertype: 'pokemon', pokemon: { color: ['炎'] } },
    item: { name: 'グッズ', supertype: 'trainer', subtype: 'item' },
    energy: { name: '基本エネルギー', supertype: 'energy', subtype: 'basic energy', energy: '草' }
};

async function harness({ left = { cards: [], counts: {} }, right = { cards: [], counts: {} } } = {}) {
    const nodes = new Map();
    const views = [];
    for (const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        nodes.set(match[2], new Element(match[1], match[2]));
    }
    for (const match of html.matchAll(/<button\b([^>]*\bclass="view-btn[^>]+)>/g)) {
        const attrs = match[1];
        const button = new Element('button');
        button.className = attrs.match(/class="([^"]+)"/)[1];
        button.dataset.view = attrs.match(/data-view="([^"]+)"/)[1];
        button.dataset.player = attrs.match(/data-player="([^"]+)"/)[1];
        views.push(button);
    }
    const document = {
        getElementById(id) {
            assert.ok(nodes.has(id), `HTML element missing: ${id}`);
            return nodes.get(id);
        },
        createElement: tagName => new Element(tagName),
        addEventListener() {},
        querySelectorAll(selector) {
            const walk = node => [node, ...node.children.flatMap(walk)];
            return [...views, ...[...nodes.values()].flatMap(walk)].filter(node => matches(node, selector));
        }
    };
    const initial = {
        deckL: left, deckR: right, cardDatabase: db, language: 'jp', i18nStrings: strings,
        'ptcg-settings': {}, playerL_name: 'Left', playerR_name: 'Right',
        prizeCardsL: Array.from({ length: 6 }, () => ({ cardId: null, isTaken: false })),
        prizeCardsR: Array.from({ length: 6 }, () => ({ cardId: null, isTaken: false }))
    };
    const reps = new Map();
    function replicant(name) {
        if (!reps.has(name)) {
            let value = initial[name];
            const listeners = [];
            reps.set(name, {
                get value() { return value; },
                set value(next) {
                    const old = value;
                    value = next;
                    for (const callback of listeners) callback(next, old);
                },
                on(_event, callback) { listeners.push(callback); }
            });
        }
        return reps.get(name);
    }
    const messages = [], importers = [], timers = [];
    const context = vm.createContext({
        document, console,
        confirm: () => true,
        alert(message) { throw new Error(message); },
        setTimeout(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer; },
        clearTimeout(timer) { if (timer) timer.cancelled = true; },
        HotkeyManager: class { on() {} },
        NodeCG: { waitForReplicants: () => Promise.resolve() },
        nodecg: {
            Replicant: replicant,
            sendMessage(name, payload) { messages.push({ name, payload }); return Promise.resolve(); },
            sendMessageToBundle(name, bundle, payload) { messages.push({ name, bundle, payload }); }
        },
        setupDeckImporter: options => importers.push(options),
        getCardImageUrl: cardId => `/cards/${cardId}.jpg`,
        getI18nText: key => strings[key]?.[replicant('language').value] || key
    });
    for (const script of inline) vm.runInContext(script, context, { filename: 'deck_viewer.html' });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    return {
        document, reps, messages, importers, timers,
        node: id => document.getElementById(id),
        view(side, view) { views.find(button => button.dataset.player === side && button.dataset.view === view).click(); }
    };
}

function tableCards(ui, side) {
    return new Map(ui.node(`deck${side}-body`).children.map(row => [row.children[0].children[0].dataset.cardId, row]));
}

function gridCards(ui, side) {
    return new Map(ui.node(`deck${side}-icon-wrapper`).children.flatMap(category =>
        category.children[1].children.map(card => [card.children[0].dataset.cardId, card])));
}

function gridCounts(ui, side) {
    return Object.fromEntries([...gridCards(ui, side)].map(([id, item]) => [id, item.children[1].textContent]));
}

function tableCounts(ui, side) {
    return Object.fromEntries([...tableCards(ui, side)].map(([id, row]) => [id, row.children[2].textContent]));
}

test('左右の List と Grid は保存枚数を表示し、カード ID は一つの行にまとめる', async () => {
    const ui = await harness({
        left: { cards: Object.keys(db), counts: { pokemonA: 4, pokemonB: 2, item: 3, energy: 11 } },
        right: { cards: ['pokemonA', 'item', 'energy'], counts: { pokemonA: 1, item: 7, energy: 2 } }
    });
    assert.deepEqual(gridCounts(ui, 'L'), { pokemonA: '×4', pokemonB: '×2', item: '×3', energy: '×11' });
    assert.deepEqual(gridCounts(ui, 'R'), { pokemonA: '×1', item: '×7', energy: '×2' });
    assert.deepEqual(ui.node('deckL-icon-wrapper').children.map(category => category.children[0].textContent),
        ['ポケモン (6)', 'トレーナーズ (3)', 'エネルギー (11)']);
    assert.deepEqual(ui.node('deckR-icon-wrapper').children.map(category => category.children[0].textContent),
        ['ポケモン (1)', 'トレーナーズ (7)', 'エネルギー (2)']);
    for (const side of ['L', 'R']) {
        ui.view(side, 'table');
        assert.equal(ui.node(`deck${side}-table-wrapper`).style.display, 'block');
        assert.equal(ui.node(`deck${side}-icon-wrapper`).style.display, 'none');
        for (const row of tableCards(ui, side).values()) assert.equal(row.children.length, 6);
    }
    assert.deepEqual(tableCounts(ui, 'L'), { pokemonA: '4', pokemonB: '2', item: '3', energy: '11' });
    assert.deepEqual(tableCounts(ui, 'R'), { pokemonA: '1', item: '7', energy: '2' });
    assert.deepEqual(ui.importers.map(importer => importer.side), ['L', 'R']);
});

test('旧デッキは重複だけを枚数として復元し、未知カードを含む分類合計を推定しない', async () => {
    const ui = await harness({ left: { cards: ['pokemonA', 'pokemonA', 'pokemonB', 'item', 'energy', 'energy', 'energy'] } });
    assert.deepEqual(gridCounts(ui, 'L'), { pokemonA: '×2', pokemonB: '—', item: '—', energy: '×3' });
    assert.deepEqual(ui.node('deckL-icon-wrapper').children.map(category => category.children[0].textContent),
        ['ポケモン (—)', 'トレーナーズ (—)', 'エネルギー (3)']);
    assert.equal(gridCards(ui, 'L').get('pokemonB').children[1].title, strings.deck_viewer_count_unknown.jp);
    ui.view('L', 'table');
    assert.deepEqual(tableCounts(ui, 'L'), { pokemonA: '2', pokemonB: '—', item: '—', energy: '3' });
    assert.equal(tableCards(ui, 'L').get('item').children[2].title, strings.deck_viewer_count_unknown.jp);
});

test('部分 counts と不正値を扱い、左右の同じ ID と更新された枚数を混同しない', async () => {
    const ui = await harness({
        left: { cards: ['pokemonA', 'pokemonA', 'pokemonB', 'item'], counts: { pokemonA: 4, item: 1 } },
        right: { cards: ['pokemonA', 'pokemonA', 'pokemonB', 'item', 'energy'],
            counts: { pokemonA: 0, pokemonB: 2.2, item: '3', energy: -1 } }
    });
    assert.deepEqual(gridCounts(ui, 'L'), { pokemonA: '×4', pokemonB: '—', item: '×1' });
    assert.deepEqual(gridCounts(ui, 'R'), { pokemonA: '×2', pokemonB: '—', item: '—', energy: '—' });
    ui.view('L', 'table');
    ui.reps.get('deckL').value = { cards: ['pokemonA', 'item'], counts: { pokemonA: 3, item: 2 } };
    assert.deepEqual(tableCounts(ui, 'L'), { pokemonA: '3', item: '2' });
    assert.equal(gridCounts(ui, 'R').pokemonA, '×2');
    ui.view('L', 'icon');
    assert.deepEqual(gridCounts(ui, 'L'), { pokemonA: '×3', item: '×2' });
});

test('四言語の枚数列・分類・不明表示は言語変更に追従する', async () => {
    const ui = await harness({ left: { cards: ['pokemonA', 'item', 'energy'], counts: { pokemonA: 4 } } });
    for (const language of ['jp', 'en', 'chs', 'cht']) {
        ui.reps.get('language').value = language;
        for (const side of ['l', 'r']) {
            assert.equal(ui.node(`header-${side}-count`).textContent, strings.deck_viewer_header_count[language]);
        }
        const categories = ui.node('deckL-icon-wrapper').children;
        for (const [index, type] of ['pokemon', 'trainer', 'energy'].entries()) {
            assert.equal(categories[index].children[0].textContent,
                `${strings[`deck_viewer_category_${type}`][language]} (${index === 0 ? 4 : '—'})`);
        }
        assert.equal(gridCards(ui, 'L').get('item').children[1].title, strings.deck_viewer_count_unknown[language]);
        assert.equal(gridCards(ui, 'L').get('pokemonA').children[1].title,
            `${strings.deck_viewer_header_count[language]}: 4`);
        ui.view('L', 'table');
        assert.equal(tableCards(ui, 'L').get('item').children[2].title, strings.deck_viewer_count_unknown[language]);
        ui.view('L', 'icon');
    }
});

test('枚数表示を加えても両表示のクリック・サイドへのドラッグ・削除は同じ ID と側を送る', async () => {
    const ui = await harness({
        left: { cards: ['pokemonA'], counts: { pokemonA: 4 } },
        right: { cards: ['pokemonA'], counts: { pokemonA: 1 } }
    });
    for (const side of ['L', 'R']) {
        for (const view of ['icon', 'table']) {
            ui.view(side, view);
            const card = (view === 'icon' ? gridCards(ui, side) : tableCards(ui, side)).get('pokemonA');
            const image = view === 'icon' ? card.children[0] : card.children[0].children[0];
            image.click();
            assert.equal(ui.reps.get(`cardToShow${side}`).value, '/cards/pokemonA.jpg');
            assert.equal(ui.messages.at(-1).payload.payload.cardId, 'pokemonA');
            assert.equal(ui.messages.at(-1).payload.payload.side, side);
            assert.equal(ui.messages.at(-1).payload.type, `SHOW_CARD_${side}`);

            const transfer = new Map();
            const dataTransfer = {
                setData: (format, value) => transfer.set(format, value),
                getData: format => transfer.get(format) || '',
                types: ['text/plain']
            };
            assert.equal(image.draggable, true);
            image.emit('dragstart', { dataTransfer });
            assert.equal(transfer.get('text/plain'), 'pokemonA');
            assert.equal(dataTransfer.effectAllowed, 'copy');
            const slot = ui.node(`prize-grid-${side}`).children[0];
            slot.emit('dragover', { dataTransfer });
            assert.equal(dataTransfer.dropEffect, 'copy');
            assert.equal(slot.classList.contains('droppable-hover'), true);
            slot.emit('drop', { dataTransfer });
            assert.equal(ui.reps.get(`prizeCards${side}`).value[0].cardId, 'pokemonA');
            assert.equal(ui.messages.at(-1).payload.type, 'SET_PRIZE_CARD');
            assert.equal(ui.messages.at(-1).payload.payload.side, side);
            assert.equal(ui.reps.get(`deck${side}`).value.counts.pokemonA, side === 'L' ? 4 : 1);

            const deleteButton = view === 'icon' ? card.children[2] : card.children[5].children[0];
            deleteButton.click();
            assert.equal(ui.messages.at(-1).name, 'removeCardFromDeck');
            assert.equal(ui.messages.at(-1).payload.cardId, 'pokemonA');
            assert.equal(ui.messages.at(-1).payload.side, side);
        }
    }
});

test('Grid の長押しとサイド内の交換・取得状態は維持する', async () => {
    const ui = await harness({ left: { cards: ['pokemonA', 'item'], counts: { pokemonA: 4, item: 2 } } });
    const card = gridCards(ui, 'L').get('pokemonA');
    card.emit('touchstart');
    const timer = ui.timers.at(-1);
    assert.equal(timer.delay, 500);
    timer.callback();
    assert.equal(card.classList.contains('active'), true);
    card.emit('touchend');
    assert.equal(timer.cancelled, true);

    ui.reps.get('prizeCardsL').value = [
        { cardId: 'pokemonA', isTaken: true }, { cardId: 'item', isTaken: false }
    ];
    const first = ui.node('prize-grid-L').children[0];
    const transfer = new Map();
    const dataTransfer = {
        setData: (format, value) => transfer.set(format, value),
        getData: format => transfer.get(format) || '',
        types: ['application/json']
    };
    first.children[0].emit('dragstart', { dataTransfer });
    assert.equal(dataTransfer.effectAllowed, 'move');
    ui.node('prize-grid-L').children[1].emit('drop', { dataTransfer });
    assert.equal(ui.reps.get('prizeCardsL').value[0].cardId, 'item');
    assert.equal(ui.reps.get('prizeCardsL').value[1].cardId, 'pokemonA');
    assert.equal(ui.reps.get('prizeCardsL').value[1].isTaken, true);
    assert.equal(ui.messages.at(-1).payload.type, 'SET_PRIZE_CARD');
    ui.node('prize-grid-L').children[1].click();
    assert.equal(ui.reps.get('prizeCardsL').value[1].isTaken, false);
    assert.equal(ui.messages.at(-1).payload.type, 'TOGGLE_PRIZE_TAKEN');
    assert.equal(ui.messages.at(-1).payload.payload.cardId, 'pokemonA');
    assert.deepEqual(gridCounts(ui, 'L'), { pokemonA: '×4', item: '×2' });
});
