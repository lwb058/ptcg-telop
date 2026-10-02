/**
 * Input: node:test, node:assert/strict, node:fs, node:path, node:vm, node:child_process
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: Node.js のテスト・VM API、Master Panel の実処理、attack_sources.js と翻訳辞書に依存する。
 * [OUTPUT]: 統一ワザ取得の進化探索・重複優先順・ベンチ共有と、折り畳み・選択・説明・打点・攻撃者の維持をオフラインで検証する。
 * [POS]: dashboard の攻撃経路の契約テスト。最小 DOM と draft Replicant を注入し、実際の対戦状態や通信には触れない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const bundleRoot = path.join(__dirname, '..');
const strings = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'i18n/strings.json'), 'utf8'));
const panelPath = 'dashboard/master_panel.html';
// ---- 回帰の再現時だけ、作業ツリーを変えずに変更前のページを読み込む ----
const panelSource = process.env.PTCG_ATTACK_BASELINE === 'HEAD'
    ? execFileSync('git', ['show', `HEAD:${panelPath}`], { cwd: bundleRoot, encoding: 'utf8' })
    : fs.readFileSync(path.join(bundleRoot, panelPath), 'utf8');

function section(start, end) {
    const first = panelSource.indexOf(start);
    assert.notEqual(first, -1, `Missing page boundary: ${start}`);
    const last = panelSource.indexOf(end, first + start.length);
    assert.notEqual(last, -1, `Missing page boundary: ${end}`);
    return panelSource.slice(first, last);
}

// ---- リストが必要とする DOM の状態とイベントだけを再現する ----
class Element {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.textContent = '';
        this.style = {};
        this.dataset = {};
        this.scrollHeight = 20;
        this.children = [];
        this.listeners = {};
        this.classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
            toggle: (name, force) => {
                const enabled = force === undefined ? !this.classes.has(name) : force;
                if (enabled) this.classes.add(name); else this.classes.delete(name);
                return enabled;
            }
        };
    }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(' '); }
    set innerHTML(value) { this.html = value; this.children = []; }
    get innerHTML() { return this.html || ''; }
    appendChild(element) { this.children.push(element); return element; }
    addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
    emit(event) { for (const callback of this.listeners[event] || []) callback({ target: this }); }
    querySelectorAll(selector) {
        const classes = selector.split('.').filter(Boolean);
        return this.children.filter(child => classes.every(name => child.classList.contains(name)));
    }
}

function attack(name, damage = '90', text = `${name} の説明`) {
    return { name, cost: ['無'], damage, text };
}

function pokemon(name, attacks = [], abilities = [], extra = {}) {
    return { name, supertype: 'pokemon', pokemon: { attacks, abilities, color: ['超'], ...extra } };
}

function fixture() {
    return {
        mew: pokemon('ミュウex', [attack('本体のワザ', '30')], [{ name: 'きおくのらせん', text: '共有する特性' }]),
        partner: pokemon('ベンチ A', [attack('ベンチのワザ', '90')], [], { color: ['炎'], evolvesFrom: ['進化前'] }),
        extra: pokemon('拡張ベンチ', [attack('拡張のワザ', '120')]),
        opponent: pokemon('相手', [attack('相手のワザ', '200')], [], {
            weaknesses: [{ type: '超' }], resistances: [{ type: '炎' }]
        }),
        normal: pokemon('通常', [attack('通常のワザ', '50')], [], { evolvesFrom: ['進化前'] }),
        pre: pokemon('進化前', [attack('進化前のワザ', '20')]),
        tm: { name: 'ワザマシン', trainer: { attacks: [attack('道具のワザ', '70')] } }
    };
}

function createHarness({ db = fixture(), turn = 'L', initial = {} } = {}) {
    const nodes = new Map();
    let uiLanguage = 'jp';
    const document = {
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, new Element(id));
            return nodes.get(id);
        },
        createElement: () => new Element(),
        querySelectorAll(selector) {
            assert.equal(selector, '[data-i18n]');
            const walk = node => [node, ...node.children.flatMap(walk)];
            return [...nodes.values()].flatMap(walk).filter(node => node.dataset.i18n);
        }
    };
    const slots = [];
    for (const side of ['L', 'R']) {
        for (let index = 0; index <= 8; index++) {
            const slotId = `slot${side}${index}`;
            slots.push({
                name: `draft_${slotId}`,
                value: { cardId: null, attachedToolIds: [], ...initial[slotId] },
                listeners: [],
                on(_event, callback) { this.listeners.push(callback); }
            });
        }
    }
    const requests = [];
    const context = vm.createContext({
        document, slots,
        cardDatabase: { value: db },
        deckL: { value: { cards: Object.keys(db) } },
        deckR: { value: { cards: [] } },
        draft_currentTurn: { value: turn },
        settingsRep: { value: { weaknessDamage: false } },
        selections: { value: [`slot${turn === 'L' ? 'R' : 'L'}0`] },
        weaknessCheck: document.getElementById('weakness-check'),
        attackBtn: document.getElementById('attack-btn'),
        aimBtn: document.getElementById('aim-btn'),
        getI18nText: key => strings[key]?.[uiLanguage] || key,
        getCardName: slotId => db[slots.find(slot => slot.name === `draft_${slotId}`)?.value.cardId]?.name || '',
        queueOperation: (type, payload) => requests.push({ type, payload }),
        alert: message => assert.fail(`Unexpected alert: ${message}`),
        highlightAttackerCard() {},
        setTimeout() { return 1; },
        clearTimeout() {}
    });
    // 実ページと同じ読込条件を使うため、HEAD の基線は新しいヘルパーを参照しない。
    if (/src=["']js\/attack_sources\.js["']/.test(panelSource)) {
        vm.runInContext(fs.readFileSync(path.join(bundleRoot, 'dashboard/js/attack_sources.js'), 'utf8'), context);
    }
    const parts = [
        section('const attackerSelect =', '// Returns the slot to highlight'),
        section('function updateUIStrings()', 'function renderField('),
        section('const getOccupiedSlots =', '// --- UI Update Functions ---'),
        section('const resistanceCheck =', '// --- Stadium Logic ---'),
        section('// A single, consolidated listener for all slot changes', '// Listeners for deck changes')
    ];
    vm.runInContext(parts.join('\n'), context, { filename: panelPath });
    vm.runInContext('updateAttackerDropdown()', context);
    const list = document.getElementById('attack-visual-list');
    function rows(name) {
        return list.children.filter(row => row.listeners.click &&
            row.innerHTML.includes(`<span class="attack-skill-name">${name}</span>`));
    }
    return {
        context, document, slots, requests, list, rows,
        damage: () => Number(document.getElementById('damage').value),
        effect: () => document.getElementById('attack-effect-text').value,
        setLanguage(language) {
            uiLanguage = language;
            vm.runInContext('updateUIStrings()', context);
        },
        choose(name, index = 0) {
            const row = rows(name)[index];
            assert.ok(row, `Expected selectable attack: ${name} #${index}`);
            row.emit('click');
            return row;
        },
        selectAttacker(slotId) {
            document.getElementById('attacker').value = slotId;
            document.getElementById('attacker').emit('change');
        },
        changeSlot(slotId, value) {
            const slot = slots.find(item => item.name === `draft_${slotId}`);
            slot.value = { cardId: null, attachedToolIds: [], ...value };
            slot.listeners.forEach(callback => callback());
        },
        groups(slotId, type = 'bench') {
            const groups = JSON.parse(vm.runInContext(`JSON.stringify(getAttackGroups({
                attackerSlotId: ${JSON.stringify(slotId)}, slots, db: cardDatabase.value,
                deckCardIds: [...deckL.value.cards, ...deckR.value.cards]
            }))`, context));
            return type ? groups.filter(group => group.type === type) : groups;
        }
    };
}

test('ベンチのワザを選択・プレビューし、実際の攻撃者のまま送信する', () => {
    const ui = createHarness({ initial: {
        slotL0: { cardId: 'mew' }, slotL1: { cardId: 'partner' }, slotR0: { cardId: 'opponent' }
    } });
    assert.equal(ui.rows('ベンチのワザ').length, 1);
    assert.equal(ui.rows('相手のワザ').length, 0);
    assert.equal(ui.damage(), 30);
    const row = ui.rows('ベンチのワザ')[0];
    assert.equal(row.classList.contains('collapsed'), false);
    assert.match(row.innerHTML, /energy-icon/);
    row.emit('mouseenter');
    assert.equal(ui.effect(), 'ベンチのワザ の説明');
    row.emit('mouseleave');
    assert.equal(ui.effect(), '本体のワザ の説明');
    ui.choose('ベンチのワザ');
    assert.equal(ui.damage(), 90);
    assert.equal(ui.effect(), 'ベンチのワザ の説明');
    assert.equal(row.classList.contains('selected'), true);
    ui.rows('本体のワザ')[0].emit('mouseenter');
    ui.rows('本体のワザ')[0].emit('mouseleave');
    assert.equal(ui.effect(), 'ベンチのワザ の説明');
    ui.document.getElementById('attack-btn').emit('click');
    const sent = JSON.parse(JSON.stringify(ui.requests[0]));
    assert.equal(sent.type, 'ATTACK');
    assert.equal(sent.payload.attackerSlotId, 'slotL0');
    assert.equal(sent.payload.attackerCardId, 'mew');
    assert.equal(sent.payload.attackerName, 'ミュウex');
    assert.equal(sent.payload.attackName, 'ベンチのワザ');
    assert.equal(sent.payload.damage, 90);
    assert.deepEqual(sent.payload.targets, ['slotR0']);
});

test('通常のポケモンは本体・道具・進化前のリストを維持し、ベンチを共有しない', () => {
    const ui = createHarness({ initial: {
        slotL0: { cardId: 'normal', attachedToolIds: ['tm'] }, slotL1: { cardId: 'partner' }
    } });
    assert.equal(ui.rows('通常のワザ').length, 1);
    assert.equal(ui.rows('道具のワザ').length, 1);
    assert.equal(ui.rows('進化前のワザ').length, 1);
    assert.equal(ui.rows('ベンチのワザ').length, 0);
    assert.equal(ui.rows('進化前のワザ')[0].classList.contains('collapsed'), true);
    ui.choose('道具のワザ');
    assert.equal(ui.damage(), 70);
    ui.choose('進化前のワザ');
    assert.equal(ui.damage(), 20);
});

test('ベンチの出典は道具の後・進化前の前に表示し、言語変更でも選択を保持する', () => {
    const db = fixture();
    db.mew.pokemon.evolvesFrom = ['進化前'];
    const ui = createHarness({ db, initial: {
        slotL0: { cardId: 'mew', attachedToolIds: ['tm'] }, slotL1: { cardId: 'partner' }
    } });
    const headers = ui.list.children.filter(row => row.children.some(child => child.dataset.i18n === 'bench_attacks'));
    assert.equal(headers.length, 1);
    const header = headers[0];
    assert.equal(header.children[1].textContent, ' 1 · ベンチ A');
    const index = row => ui.list.children.indexOf(row);
    assert.ok(index(ui.rows('道具のワザ')[0]) < index(header));
    assert.ok(index(header) < index(ui.rows('ベンチのワザ')[0]));
    assert.ok(index(ui.rows('ベンチのワザ')[0]) < index(ui.rows('進化前のワザ')[0]));
    const selected = ui.choose('ベンチのワザ');
    for (const language of ['jp', 'en', 'chs', 'cht']) {
        ui.setLanguage(language);
        assert.equal(header.children[0].textContent, strings.bench_attacks[language]);
        assert.equal(header.children[1].textContent, ' 1 · ベンチ A');
        assert.equal(selected.classList.contains('selected'), true);
        assert.equal(ui.damage(), 90);
        assert.equal(ui.effect(), 'ベンチのワザ の説明');
    }
});

test('手動選択したベンチの特性では共有せず、Auto に戻すと戦闘場から再判定する', () => {
    const ui = createHarness({ initial: {
        slotL0: { cardId: 'mew' }, slotL1: { cardId: 'partner' }, slotL2: { cardId: 'mew' }
    } });
    ui.selectAttacker('slotL2');
    assert.equal(ui.rows('ベンチのワザ').length, 0);
    assert.deepEqual(ui.groups('slotL2'), []);
    ui.selectAttacker('auto');
    assert.equal(ui.rows('ベンチのワザ').length, 1);
});

test('左右とも自分の 1–8 を順番に共有し、空欄・欠落 DB・ワザなしを除外する', () => {
    for (const side of ['L', 'R']) {
        const other = side === 'L' ? 'R' : 'L';
        const db = fixture();
        db.noAttacks = pokemon('ワザなし');
        db.noPokemon = { name: '対象外', trainer: {} };
        const ui = createHarness({ db, turn: side, initial: {
            [`slot${side}0`]: { cardId: 'mew' },
            [`slot${side}1`]: { cardId: 'partner', attachedToolIds: ['tm'] },
            [`slot${side}2`]: { cardId: 'missing' },
            [`slot${side}3`]: { cardId: 'noAttacks' },
            [`slot${side}4`]: { cardId: 'noPokemon' },
            [`slot${side}6`]: { cardId: 'extra' },
            [`slot${side}8`]: { cardId: 'partner' },
            [`slot${other}0`]: { cardId: 'opponent' },
            [`slot${other}1`]: { cardId: 'opponent' }
        } });
        ui.slots.reverse();
        const groups = ui.groups(`slot${side}0`);
        assert.deepEqual(groups.map(group => group.slotId), [`slot${side}1`, `slot${side}6`, `slot${side}8`]);
        assert.deepEqual(groups.map(group => group.name), ['ベンチ A', '拡張ベンチ', 'ベンチ A']);
        assert.equal(ui.rows('ベンチのワザ').length, 2);
        assert.equal(ui.rows('拡張のワザ').length, 1);
        assert.equal(ui.rows('相手のワザ').length, 0);
        assert.equal(ui.rows('進化前のワザ').length, 0);
        assert.equal(ui.rows('道具のワザ').length, 0);
    }
});

test('同名のワザでも各出典の打点と説明を保持する', () => {
    const db = fixture();
    db.mew.pokemon.attacks = [attack('同名のワザ', '30', '本体')];
    db.partner.pokemon.attacks = [attack('同名のワザ', '90', 'ベンチ A')];
    db.extra.pokemon.attacks = [attack('同名のワザ', '120', 'ベンチ B')];
    const ui = createHarness({ db, initial: {
        slotL0: { cardId: 'mew' }, slotL1: { cardId: 'partner' }, slotL8: { cardId: 'extra' }
    } });
    assert.equal(ui.rows('同名のワザ').length, 3);
    for (const [index, damage, text] of [[0, 30, '本体'], [1, 90, 'ベンチ A'], [2, 120, 'ベンチ B']]) {
        ui.choose('同名のワザ', index);
        assert.equal(ui.damage(), damage);
        assert.equal(ui.effect(), text);
    }
});

test('空の翻訳欄は一致せず、英語・簡体字・繁体字を設定した後に特性名で一致する', () => {
    for (const [language, name] of [['en', 'TEST_MEMORY_EN'], ['chs', '测试特性'], ['cht', '測試特性']]) {
        const db = fixture();
        db.mew.name = '別名のポケモン';
        db.mew.pokemon.abilities = [{ name: '' }];
        const ui = createHarness({ db, initial: { slotL0: { cardId: 'mew' }, slotL1: { cardId: 'partner' } } });
        assert.equal(ui.rows('ベンチのワザ').length, 0);
        assert.deepEqual(ui.groups('slotL0'), []);
        vm.runInContext(`MEMORY_SPIRAL_ABILITY_NAMES.${language} = ''`, ui.context);
        assert.equal(vm.runInContext(`MEMORY_SPIRAL_ABILITY_NAMES.${language}`, ui.context), '');
        db.mew.pokemon.abilities = [{ name }];
        assert.deepEqual(ui.groups('slotL0'), []);
        vm.runInContext(`MEMORY_SPIRAL_ABILITY_NAMES.${language} = ${JSON.stringify(name)}`, ui.context);
        vm.runInContext('updateAttackVisualList()', ui.context);
        assert.equal(ui.rows('ベンチのワザ').length, 1);
    }
});

test('設定済みの四言語の特性名は表示言語とポケモン名に依存しない', () => {
    for (const name of ['きおくのらせん', 'Memory Helix', '记忆螺旋', '記憶螺旋']) {
        const db = fixture();
        db.mew.name = '別のカード名';
        db.mew.pokemon.abilities = [{ name: ` ${name} ` }];
        const ui = createHarness({ db, initial: { slotL0: { cardId: 'mew' }, slotL1: { cardId: 'partner' } } });
        ui.setLanguage('en');
        assert.equal(ui.rows('ベンチのワザ').length, 1);
    }
});

test('両デッキの同名版・多段進化・循環を探索し、既存の重複優先順と折り畳みを保つ', () => {
    const db = fixture();
    db.normal.pokemon.attacks.push(attack('本体と重複', '50'));
    db.normal.pokemon.evolvesFrom = ['中間', '未収録'];
    db.middleA = pokemon('中間', [attack('本体と重複', '999'), attack('道具と重複', '80')], [], { evolvesFrom: ['たね'] });
    db.middleB = pokemon('中間', [attack('別版のワザ', '100'), attack('道具と重複', '999')], [], { evolvesFrom: ['たね'] });
    db.outsideDeck = pokemon('中間', [attack('デッキ外', '999')]);
    db.base = pokemon('たね', [attack('祖先のワザ', '10')], [], { evolvesFrom: ['中間'] });
    db.tm.trainer.attacks.push(attack('道具と重複', '999'));
    const snapshot = JSON.stringify(db);
    const ui = createHarness({ db, initial: { slotL0: { cardId: 'normal', attachedToolIds: ['tm'] } } });
    ui.context.deckL.value.cards = ['normal', 'middleA', 'missing', 'middleA'];
    ui.context.deckR.value.cards = ['middleB', 'base'];
    vm.runInContext('updateAttackVisualList()', ui.context);

    const groups = ui.groups('slotL0', null);
    assert.deepEqual(groups.map(group => group.type), ['own', 'tm', 'preEvolution', 'preEvolution']);
    assert.deepEqual(groups.slice(2).map(group => group.name), ['中間', 'たね']);
    assert.equal(ui.rows('デッキ外').length, 0);
    assert.equal(ui.rows('本体と重複').length, 1);
    assert.equal(ui.rows('道具と重複').length, 1);
    assert.equal(ui.rows('別版のワザ').length, 1);
    ui.choose('本体と重複');
    assert.equal(ui.damage(), 50);

    const header = ui.list.children.find(row => row.textContent === '▶ 中間');
    assert.ok(header);
    header.emit('click');
    assert.equal(ui.rows('道具と重複')[0].classList.contains('collapsed'), false);
    assert.equal(ui.rows('別版のワザ')[0].classList.contains('collapsed'), false);
    assert.equal(ui.rows('祖先のワザ')[0].classList.contains('collapsed'), true);
    ui.choose('道具と重複');
    assert.equal(ui.damage(), 80);
    assert.equal(ui.effect(), '道具と重複 の説明');
    header.emit('click');
    assert.equal(ui.rows('道具と重複')[0].classList.contains('collapsed'), true);
    assert.equal(JSON.stringify(db), snapshot);
});

test('ワザなしの中間形態からも祖先を取得し、手動ベンチ選択と欠落資料を扱う', () => {
    const db = fixture();
    db.normal.pokemon.attacks = [];
    db.normal.pokemon.evolvesFrom = ['中間'];
    db.middle = pokemon('中間', [], [], { evolvesFrom: ['進化前'] });
    const ui = createHarness({ db, initial: { slotL0: { cardId: 'normal' }, slotL1: { cardId: 'normal' } } });
    assert.deepEqual(ui.groups('slotL0', null).map(group => group.type), ['preEvolution']);
    assert.equal(ui.damage(), 20);
    ui.selectAttacker('slotL1');
    assert.equal(ui.rows('進化前のワザ').length, 1);
    assert.equal(ui.damage(), 20);
    assert.deepEqual(ui.groups('slotL8', null), []);
    ui.changeSlot('slotL1', { cardId: 'missing' });
    assert.equal(ui.list.children.length, 0);
    assert.equal(ui.damage(), 0);
    ui.context.cardDatabase.value = null;
    assert.deepEqual(ui.groups('slotL0', null), []);
});

test('ベンチの追加・進化・削除と戦闘場の交換でリストを即座に更新する', () => {
    const ui = createHarness({ initial: { slotL0: { cardId: 'mew' } } });
    assert.equal(ui.rows('ベンチのワザ').length, 0);
    ui.changeSlot('slotL1', { cardId: 'partner' });
    ui.choose('ベンチのワザ');
    ui.changeSlot('slotL1', { cardId: 'extra' });
    assert.equal(ui.rows('ベンチのワザ').length, 0);
    assert.equal(ui.rows('拡張のワザ').length, 1);
    assert.equal(ui.damage(), 30);
    assert.equal(ui.effect(), '本体のワザ の説明');
    ui.changeSlot('slotL1', {});
    assert.equal(ui.rows('拡張のワザ').length, 0);
    ui.changeSlot('slotL8', { cardId: 'partner' });
    ui.changeSlot('slotL0', { cardId: 'normal' });
    assert.equal(ui.rows('ベンチのワザ').length, 0);
    ui.changeSlot('slotL0', {});
    assert.equal(ui.list.children.length, 0);
    assert.equal(ui.damage(), 0);
});

test('借りたワザも攻撃者の属性で弱点・抵抗力を適用し、説明内の打点を解析する', () => {
    const db = fixture();
    db.partner.pokemon.attacks.push(attack('ベンチ指定', '', '相手のポケモン2匹に、それぞれ40ダメージ。'));
    const ui = createHarness({ db, initial: {
        slotL0: { cardId: 'mew' }, slotL1: { cardId: 'partner' }, slotR0: { cardId: 'opponent' }
    } });
    ui.choose('ベンチのワザ');
    vm.runInContext('settingsRep.value.weaknessDamage = true; updateWeaknessAndResistanceChecks()', ui.context);
    assert.equal(ui.document.getElementById('weakness-check').checked, true);
    assert.equal(ui.document.getElementById('resistance-check').checked, false);
    assert.equal(ui.damage(), 180);
    ui.document.getElementById('weakness-check').checked = false;
    ui.document.getElementById('resistance-check').checked = true;
    ui.document.getElementById('resistance-check').emit('change');
    assert.equal(ui.damage(), 60);
    ui.document.getElementById('resistance-check').checked = false;
    ui.choose('ベンチ指定');
    assert.equal(ui.damage(), 40);
});
