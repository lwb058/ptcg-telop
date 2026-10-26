/**
 * [INPUT]: Node.js のテスト・VM API、main/extra の実 HTML と共通描画器、ブラウザーの DOM・時計・NodeCG 境界に依存する。
 * [OUTPUT]: 画面の演出完了通知が指定された批次と画面に属し、描画・入替・被弾の完了を待つことをオフラインで検証する。
 * [POS]: extension のブラウザー契約テスト。内部の描画器は置換せず、実 HTML が受け取る通知と live 更新から ACK を観測する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const graphicsRoot = path.join(__dirname, '..', 'graphics');
const read = file => fs.readFileSync(path.join(graphicsRoot, file), 'utf8');
const emptySlot = () => ({ cardId: null, instanceId: null, damage: 0, attachedEnergy: [], attachedToolIds: [], ailments: [] });
const pokemon = (instanceId = 'L_fixture') => ({ ...emptySlot(), cardId: 'fixture', instanceId });
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve(); }

// ---- ブラウザーの DOM・動画イベント境界 ----
class Element {
    constructor(tag = 'div', id = '') {
        this.tagName = tag.toUpperCase();
        this.id = id;
        this.className = '';
        this.dataset = {};
        this.children = [];
        this.listeners = new Map();
        this.subnodes = new Map();
        this.autoLoad = true;
        this.style = { setProperty() {} };
        this.classList = {
            add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
            contains: name => this.className.split(' ').includes(name),
            toggle: (name, force) => {
                const enabled = force === undefined ? !this.classList.contains(name) : force;
                this.classList[enabled ? 'add' : 'remove'](name);
                return enabled;
            }
        };
    }
    set src(value) { this._src = value; if (this.autoLoad) queueMicrotask(() => { this.onload?.(); this.dispatch('load'); }); }
    get src() { return this._src; }
    set innerHTML(value) { this._html = value; this.children = []; this.subnodes.clear(); }
    get innerHTML() { return this._html || ''; }
    set outerHTML(value) { this.innerHTML = value; }
    get firstChild() { return this.children[0] || null; }
    addEventListener(name, callback, options) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push({ callback, once: !!options?.once }); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item.callback !== callback)); }
    dispatch(name, event = {}) {
        for (const item of [...(this.listeners.get(name) || [])]) {
            if (item.once) this.removeEventListener(name, item.callback);
            item.callback({ target: this, ...event });
        }
    }
    appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; return node; }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
        this.parentElement = null;
    }
    querySelector(selector) {
        if (!this.subnodes.has(selector)) {
            const node = new Element(selector.includes('video') ? 'video' : selector.includes('image') ? 'img' : 'div');
            node.autoLoad = this.autoLoad;
            node.imageComplete = this.imageComplete;
            node.complete = !!this.imageComplete;
            this.subnodes.set(selector, node);
        }
        return this.subnodes.get(selector);
    }
    querySelectorAll() { return []; }
    closest() { return null; }
    insertAdjacentHTML(_position, html) { this.innerHTML = html; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    load() {}
    play() { return Promise.resolve(); }
}

async function graphicHarness(graphic, { imageAutoLoad = true } = {}) {
    const html = read(`${graphic}.html`);
    const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element('div', match[1])]));
    for (const [id, element] of nodes) {
        element.autoLoad = imageAutoLoad;
        if (/^slot-[LR]0$/.test(id)) element.classList.add('active-slot');
    }
    const document = {
        body: new Element('body'), head: new Element('head'), documentElement: new Element('html'),
        listeners: [], addEventListener(name, callback) { if (name === 'DOMContentLoaded') this.listeners.push(callback); },
        getElementById: id => nodes.get(id) || null,
        querySelectorAll: () => [], createElement: tag => new Element(tag)
    };
    const reps = new Map(), handlers = new Map(), acks = [], errors = [];
    const defaults = {
        cardDatabase: { fixture: { name: 'Fixture', pokemon: { hp: 100, abilities: [], attacks: [] } } },
        'ptcg-settings': { language: 'jp', activeTheme: 'Default', hideAttackName: false },
        language: 'jp', assetPaths: { cardImgPath: 'assets/ptcg-telop/card_img_jp/' },
        extraBenchVisible: { left: false, right: false }, firstMove: 'L', turnCount: 1,
        deckL: { cards: [] }, deckR: { cards: [] }, camMode: { L: false, R: false },
        live_stadium: { cardId: null }, live_sideL: 6, live_sideR: 6
    };
    function replicant(name) {
        if (!reps.has(name)) reps.set(name, {
            value: name.startsWith('live_slot') ? emptySlot() : defaults[name] ?? {},
            callbacks: [], on(_event, callback) { this.callbacks.push(callback); }
        });
        return reps.get(name);
    }
    let now = 0, sequence = 0;
    const timers = new Map();
    function schedule(callback, delay = 0) { const id = ++sequence; timers.set(id, { callback, time: now + delay }); return id; }
    const context = vm.createContext({ document, console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
        queueMicrotask, Promise, Set, Map, Image: Element,
        fetch: async () => ({ text: async () => '' }),
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        setTimeout: schedule, clearTimeout: id => timers.delete(id),
        requestAnimationFrame: callback => schedule(() => callback(now), 16),
        nodecg: {
            Replicant: replicant,
            listenFor(name, callback) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback); },
            sendMessage(name, payload) { if (name === 'animationBatchComplete') acks.push(JSON.parse(JSON.stringify(payload ?? null))); return Promise.resolve(); }
        }, NodeCG: { waitForReplicants: async () => {} }
    });
    context.window = context;
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        const filename = script[1].match(/src="([^"]+)"/)?.[1];
        vm.runInContext(filename ? read(filename) : script[2], context, { filename: filename || `${graphic}.html` });
    }
    for (const callback of document.listeners) callback();
    await flush();
    assert.deepEqual(errors, [], 'graphic 初始化应成功');
    async function advance(milliseconds) {
        const end = now + milliseconds;
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.time <= end).sort((a, b) => a[1].time - b[1].time || a[0] - b[0])[0];
            if (!next) break;
            now = next[1].time;
            timers.delete(next[0]);
            next[1].callback();
            await flush();
        }
        now = end;
        await flush();
    }
    function notify(name, payload) { for (const callback of handlers.get(name) || []) callback(payload); }
    function change(name, value) {
        const rep = replicant(name), oldValue = rep.value;
        rep.value = value;
        for (const callback of rep.callbacks) callback(value, oldValue);
    }
    return { acks, errors, nodes, document, reps, notify, change, advance };
}

test('main は明示された批次の終了まで ACK せず、完了通知に批次と画面を含める', async () => {
    const ui = await graphicHarness('main');
    ui.notify('animationBatchStart', { batchId: 'main-enter', graphics: ['main'] });
    ui.notify('playAnimation', { batchId: 'main-enter', type: 'ENTER_POKEMON', target: 'slot-L0' });
    await ui.advance(200);
    assert.deepEqual(ui.acks, []);
    ui.nodes.get('slot-L0').dispatch('animationend');
    await flush();
    assert.deepEqual(ui.acks, [], '演出が完了しても End より前には通知しない');
    ui.notify('animationBatchEnd', { batchId: 'main-enter' });
    await flush();
    assert.deepEqual(ui.acks, [{ batchId: 'main-enter', graphic: 'main' }]);
});

test('extra も自身の入替を待ち、main だけの批次には応答しない', async () => {
    const ui = await graphicHarness('extra');
    ui.notify('animationBatchStart', { batchId: 'main-only', graphics: ['main'] });
    ui.notify('animationBatchEnd', { batchId: 'main-only' });
    await flush();
    assert.deepEqual(ui.acks, []);
    ui.notify('animationBatchStart', { batchId: 'extra-enter', graphics: ['extra'] });
    ui.notify('playAnimation', { batchId: 'extra-enter', type: 'ENTER_POKEMON', target: 'slot-L6' });
    ui.notify('animationBatchEnd', { batchId: 'extra-enter' });
    await flush();
    assert.deepEqual(ui.acks, []);
    ui.nodes.get('slot-L6').dispatch('animationend');
    await flush();
    assert.deepEqual(ui.acks, [{ batchId: 'extra-enter', graphic: 'extra' }]);
});

test('履歴の識別なし通知は現行批次の完了を妨げない', async () => {
    const ui = await graphicHarness('main');
    ui.notify('animationBatchStart', { batchId: 'current', graphics: ['main'] });
    ui.notify('playAnimation', { type: 'ENTER_POKEMON', target: 'slot-L0' });
    ui.notify('animationBatchEnd', { batchId: 'current' });
    await flush();
    assert.deepEqual(ui.acks, [{ batchId: 'current', graphic: 'main' }]);
});

test('extra の攻撃通知は遅延被弾動画と揺れが終了するまで ACK しない', async () => {
    const ui = await graphicHarness('extra');
    ui.notify('animationBatchStart', { batchId: 'attack-extra', graphics: ['extra'] });
    ui.notify('attack-fx', { batchId: 'attack-extra', attackerSide: 'R', attackerType: '炎', targets: [{ targetId: 'slotL6', targetSide: 'L', damage: 30 }] });
    ui.notify('animationBatchEnd', { batchId: 'attack-extra' });
    await flush();
    assert.deepEqual(ui.acks, []);
    await ui.advance(1000);
    const video = ui.nodes.get('slot-L6').children.find(node => node.className === 'hit-effect');
    assert.ok(video, '1000ms 後に被弾動画を作る');
    video.dispatch('ended');
    await flush();
    assert.deepEqual(ui.acks, [], '動画が先に終わっても揺れを待つ');
    await ui.advance(400);
    assert.deepEqual(ui.acks, [{ batchId: 'attack-extra', graphic: 'extra' }]);
});

test('新カードの live 描画は画像読込後の滑入が完了するまで ACK しない', async () => {
    const ui = await graphicHarness('main', { imageAutoLoad: false });
    ui.notify('animationBatchStart', { batchId: 'new-card', graphics: ['main'] });
    ui.change('live_slotL0', pokemon());
    ui.notify('animationBatchEnd', { batchId: 'new-card' });
    await flush();
    assert.deepEqual(ui.acks, [], '画像の読込待機も renderSlot の完了に含まれる');
    const image = ui.nodes.get('slot-L0').querySelector('.active-pokemon-wrapper').querySelector('.pokemon-image');
    image.dispatch('load');
    await flush();
    assert.deepEqual(ui.acks, [], '画像読込後は滑入の終了を待つ');
    ui.nodes.get('slot-L0').dispatch('animationend');
    await flush();
    assert.deepEqual(ui.acks, [{ batchId: 'new-card', graphic: 'main' }]);
});

for (const [graphic, slotId, repName, index] of [['main', 'slot-L0', 'live_slotL0', 0], ['extra', 'slot-L6', 'live_slotL6', 6]]) {
    test(`${graphic}: 初期・履歴・資源の再描画から ACK を生成しない`, async () => {
        const ui = await graphicHarness(graphic);
        ui.change(repName, pokemon());
        ui.change('assetPaths', { cardImgPath: 'assets/ptcg-telop/card_img_chs/' });
        ui.change('ptcg-settings', { language: 'chs', activeTheme: 'Default' });
        await ui.advance(3000);
        assert.deepEqual(ui.acks, []);
    });

    test(`${graphic}: 明示的な空批次は一回だけ応答し、reload で見落とした Start は応答しない`, async () => {
        const ui = await graphicHarness(graphic);
        ui.notify('animationBatchEnd', { batchId: 'missed-start' });
        ui.notify('animationBatchStart', { graphics: [graphic] });
        ui.notify('animationBatchEnd', {});
        await flush();
        assert.deepEqual(ui.acks, []);
        ui.notify('animationBatchStart', { batchId: 'empty', graphics: [graphic] });
        ui.notify('animationBatchStart', { batchId: 'empty', graphics: [graphic] });
        ui.notify('animationBatchEnd', { batchId: 'empty' });
        ui.notify('animationBatchEnd', { batchId: 'empty' });
        await flush();
        ui.notify('animationBatchEnd', { batchId: 'empty' });
        await flush();
        assert.deepEqual(ui.acks, [{ batchId: 'empty', graphic }]);
    });

    test(`${graphic}: 取消済み Promise の完了は次の批次を解除しない`, async () => {
        const ui = await graphicHarness(graphic);
        ui.notify('animationBatchStart', { batchId: 'old', graphics: [graphic] });
        ui.notify('playAnimation', { batchId: 'old', type: 'ENTER_POKEMON', target: slotId });
        ui.notify('animationBatchEnd', { batchId: 'old' });
        ui.notify('animationBatchCancelled', { batchId: 'old' });
        ui.notify('animationBatchStart', { batchId: 'new', graphics: [graphic] });
        const nextSlot = slotId.replace(String(index), String(index + 1));
        ui.notify('playAnimation', { batchId: 'new', type: 'ENTER_POKEMON', target: nextSlot });
        ui.notify('animationBatchEnd', { batchId: 'new' });
        ui.nodes.get(slotId).dispatch('animationend');
        await flush();
        assert.deepEqual(ui.acks, []);
        ui.notify('animationBatchCancelled', { batchId: 'old' });
        ui.notify('animationBatchEnd', { batchId: 'old' });
        ui.nodes.get(nextSlot).dispatch('animationend');
        await flush();
        assert.deepEqual(ui.acks, [{ batchId: 'new', graphic }]);
    });

    test(`${graphic}: live のダメージ表示 Promise は数字演出の完了を待つ`, async () => {
        const ui = await graphicHarness(graphic);
        ui.change(repName, pokemon());
        await ui.advance(1100);
        ui.notify('animationBatchStart', { batchId: 'damage', graphics: [graphic] });
        ui.change(repName, { ...pokemon(), damage: 30 });
        ui.notify('animationBatchEnd', { batchId: 'damage' });
        await ui.advance(600);
        assert.deepEqual(ui.acks, []);
        await ui.advance(1000);
        assert.deepEqual(ui.acks, [{ batchId: 'damage', graphic }]);
    });

    for (const event of ['error', 'cached']) {
        test(`${graphic}: 画像の ${event} でも滑入の完了を待って応答する`, async () => {
            const ui = await graphicHarness(graphic, { imageAutoLoad: false });
            const slot = ui.nodes.get(slotId);
            slot.imageComplete = event === 'cached';
            slot.querySelector(index === 0 ? '.active-pokemon-wrapper' : '.bench-pokemon-wrapper').imageComplete = slot.imageComplete;
            ui.notify('animationBatchStart', { batchId: `image-${event}`, graphics: [graphic] });
            ui.change(repName, pokemon());
            ui.notify('animationBatchEnd', { batchId: `image-${event}` });
            const image = slot.querySelector(index === 0 ? '.active-pokemon-wrapper' : '.bench-pokemon-wrapper').querySelector('.pokemon-image');
            if (event === 'error') image.dispatch('error');
            await flush();
            assert.deepEqual(ui.acks, []);
            assert.equal(slot.classList.contains('anim-slide-in-L'), true);
            slot.dispatch('animationend');
            await flush();
            assert.deepEqual(ui.acks, [{ batchId: `image-${event}`, graphic }]);
        });
    }

    test(`${graphic}: reset 後の古い画像読込は空スロットを復活させない`, async () => {
        const ui = await graphicHarness(graphic, { imageAutoLoad: false });
        const slot = ui.nodes.get(slotId);
        ui.notify('animationBatchStart', { batchId: 'old-image', graphics: [graphic] });
        ui.change(repName, pokemon());
        const image = slot.querySelector(index === 0 ? '.active-pokemon-wrapper' : '.bench-pokemon-wrapper').querySelector('.pokemon-image');
        ui.notify('animationBatchEnd', { batchId: 'old-image' });
        ui.notify('animationBatchCancelled', { batchId: 'old-image' });
        ui.change(repName, emptySlot());
        image.dispatch('load');
        await flush();
        assert.equal(slot.classList.contains('is-empty'), true);
        assert.equal(slot.classList.contains('anim-slide-in-L'), false);
        assert.deepEqual(ui.acks, []);
    });

    test(`${graphic}: 古い滑出の遅延クリアは reset 後の新カードを消さない`, async () => {
        const ui = await graphicHarness(graphic);
        const slot = ui.nodes.get(slotId);
        ui.change(repName, pokemon('old'));
        await ui.advance(1100);
        slot.classList.add('anim-slide-out-L');
        ui.change(repName, emptySlot());
        ui.change(repName, pokemon('new'));
        await ui.advance(600);
        assert.equal(slot.classList.contains('is-empty'), false);
    });

    test(`${graphic}: 旧退場の完了は reset 後の新しい個体を消さない`, async () => {
        const ui = await graphicHarness(graphic);
        const slot = ui.nodes.get(slotId);
        ui.change(repName, pokemon('old-exit'));
        await ui.advance(1100);
        ui.notify('animationBatchStart', { batchId: 'old-exit', graphics: [graphic] });
        ui.notify('playAnimation', { batchId: 'old-exit', type: 'EXIT_POKEMON', target: slotId });
        ui.change(repName, emptySlot());
        ui.notify('animationBatchCancelled', { batchId: 'old-exit' });
        ui.change(repName, pokemon('new-exit'));
        await ui.advance(1500);
        assert.equal(slot.classList.contains('is-empty'), false);
        assert.equal(slot.dataset.instanceId, 'new-exit');
    });

    test(`${graphic}: 旧 KO の動画と時計は新しい個体を隠さない`, async () => {
        const ui = await graphicHarness(graphic);
        const slot = ui.nodes.get(slotId);
        ui.change(repName, pokemon('old-ko'));
        await ui.advance(1100);
        ui.notify('animationBatchStart', { batchId: 'old-ko', graphics: [graphic] });
        ui.notify('playAnimation', { batchId: 'old-ko', type: 'KO_POKEMON', target: slotId });
        const oldVideo = slot.children.find(element => element.tagName === 'VIDEO');
        assert.ok(oldVideo);
        ui.change(repName, emptySlot());
        ui.notify('animationBatchCancelled', { batchId: 'old-ko' });
        ui.change(repName, pokemon('new-ko'));
        await ui.advance(90);
        const image = slot.querySelector(index === 0 ? '.active-pokemon-wrapper' : '.bench-pokemon-wrapper').querySelector('.pokemon-image');
        assert.equal(image.style.visibility, 'visible');
        oldVideo.dispatch('ended');
        assert.equal(slot.classList.contains('anim-slide-out-L'), false);
        await ui.advance(1500);
        assert.equal(slot.classList.contains('anim-slide-out-L'), false);
        assert.equal(slot.classList.contains('is-empty'), false);
    });
}

test('main の攻撃通知は招式の表示後に作る被弾動画と揺れを待つ', async () => {
    const ui = await graphicHarness('main');
    ui.notify('animationBatchStart', { batchId: 'attack-main', graphics: ['main'] });
    ui.notify('attack-fx', { batchId: 'attack-main', attackerSide: 'R', attackerType: '炎', moveName: 'Move', attackerName: 'Fixture', targets: [{ targetId: 'slotL0', targetSide: 'L', damage: 30 }] });
    ui.notify('animationBatchEnd', { batchId: 'attack-main' });
    await flush();
    assert.deepEqual(ui.acks, []);
    ui.nodes.get('attack-fx-container').querySelector('.attack-fx-video').dispatch('ended');
    const hitVideo = ui.nodes.get('slot-L0').children.find(node => node.className === 'hit-effect');
    assert.ok(hitVideo);
    hitVideo.dispatch('ended');
    await ui.advance(449);
    assert.deepEqual(ui.acks, []);
    await ui.advance(1);
    assert.deepEqual(ui.acks, [{ batchId: 'attack-main', graphic: 'main' }]);
});

test('main と extra をまたぐ入替は各画面が自身の演出を待って同じ批次へ応答する', async () => {
    const main = await graphicHarness('main'), extra = await graphicHarness('extra');
    const begin = { batchId: 'mixed', graphics: ['main', 'extra'] };
    const animation = { batchId: 'mixed', type: 'SWITCH_POKEMON', involvedSlots: ['slot-L0', 'slot-L6'] };
    for (const [ui, slotId] of [[main, 'slot-L0'], [extra, 'slot-L6']]) {
        ui.nodes.get(slotId).classList.remove('is-empty');
        ui.notify('animationBatchStart', begin);
        ui.notify('playAnimation', animation);
        ui.notify('animationBatchEnd', { batchId: 'mixed' });
    }
    main.nodes.get('slot-L0').dispatch('animationend');
    await flush();
    assert.deepEqual(main.acks, [{ batchId: 'mixed', graphic: 'main' }]);
    assert.deepEqual(extra.acks, []);
    extra.nodes.get('slot-L6').dispatch('animationend');
    await flush();
    assert.deepEqual(extra.acks, [{ batchId: 'mixed', graphic: 'extra' }]);
});

test('共有収集器は一つの拒否で早期通知せず、残りの Promise も待つ', async () => {
    const handlers = new Map(), acks = [];
    const context = vm.createContext({ window: {}, nodecg: {
        listenFor(name, callback) { handlers.set(name, callback); },
        sendMessage(_name, payload) { acks.push(JSON.parse(JSON.stringify(payload))); return Promise.resolve(); }
    } });
    vm.runInContext(read('animation-batch.js'), context);
    const collector = context.window.AnimationBatch.create({ nodecg: context.nodecg, graphic: 'main' });
    handlers.get('animationBatchStart')({ batchId: 'rejected', graphics: ['main'] });
    collector.add(Promise.reject(new Error('Browser animation failed')));
    let complete;
    collector.add(new Promise(resolve => { complete = resolve; }));
    handlers.get('animationBatchEnd')({ batchId: 'rejected' });
    await flush();
    assert.deepEqual(acks, []);
    complete();
    await flush();
    assert.deepEqual(acks, [{ batchId: 'rejected', graphic: 'main' }]);
});
