/**
 * Input: node:test, node:assert/strict, node:fs, node:path, node:vm
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: Node.js のテスト・VM API、診断ダウンロードと取り込み UI の実スクリプト、翻訳辞書に依存する。
 * [OUTPUT]: 別 realm を含む ZIP 応答形式、連打抑止、多言語状態、原因・警告表示と成功済みデッキ ID の保護をオフラインで検証する。
 * [POS]: extension のブラウザー契約テスト。最小 DOM と NodeCG 応答を注入し、実ログ・カード API・ユーザーの Replicant を変更しない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundleRoot = path.join(__dirname, '..');
const strings = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'i18n/strings.json'), 'utf8'));
const source = file => fs.readFileSync(path.join(bundleRoot, file), 'utf8');

// ---- UI が使用する DOM 境界 ----
class Element {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.disabled = false;
        this.textContent = '';
        this.style = {};
        this.listeners = {};
        this.children = [];
        this.attrs = {};
        this.subnodes = new Map();
        this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    }
    addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    querySelector(selector) {
        if (!this.subnodes.has(selector)) this.subnodes.set(selector, new Element(selector));
        return this.subnodes.get(selector);
    }
    querySelectorAll() { return []; }
    remove() { this.removed = true; }
    click() { this.clicked = true; }
}

function makeDocument() {
    const nodes = new Map();
    return {
        body: new Element('body'),
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, new Element(id));
            return nodes.get(id);
        },
        createElement: tag => new Element(tag),
        querySelectorAll: () => []
    };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function flush() { for (let index = 0; index < 10; index++) await Promise.resolve(); }

function exportHarness() {
    const document = makeDocument();
    const requests = [], blobs = [], revoked = [], timers = [];
    let language = 'chs';
    const context = vm.createContext({
        document, ArrayBuffer, Uint8Array, Blob,
        setTimeout: callback => { timers.push(callback); },
        URL: {
            createObjectURL(blob) { blobs.push(blob); return `blob:diagnostics-${blobs.length}`; },
            revokeObjectURL(url) { revoked.push(url); }
        },
        nodecg: {
            sendMessage(name) {
                const request = deferred();
                requests.push({ name, ...request });
                return request.promise;
            }
        }
    });
    vm.runInContext(source('dashboard/js/diagnostic_export.js'), context);
    const ui = context.setupDiagnosticExport({ getI18nText: key => strings[key][language] });
    const button = document.getElementById('export-import-diagnostics-btn');
    const status = document.getElementById('import-diagnostics-status');
    return { document, button, status, requests, blobs, revoked, timers,
        click: () => button.listeners.click[0](),
        setLanguage(lang) { language = lang; ui.updateLabels(); } };
}

function importHarness({ language = 'chs', onDeckIdChange } = {}) {
    const document = makeDocument();
    const reps = new Map(), requests = [], alerts = [];
    function replicant(name) {
        if (!reps.has(name)) reps.set(name, {
            value: name === 'ptcg-settings' ? { language } : name === 'i18nStrings' ? strings : { loading: false },
            callbacks: [], on(_event, callback) { this.callbacks.push(callback); }
        });
        return reps.get(name);
    }
    const context = vm.createContext({ document, console, alert: message => alerts.push(message), nodecg: {
        Replicant: replicant,
        sendMessage(name, payload) {
            const request = deferred();
            requests.push({ name, payload, ...request });
            return request.promise;
        }
    } });
    vm.runInContext(source('dashboard/js/deck_importer.js'), context);
    context.setupDeckImporter({ side: 'L', inputId: 'input', buttonId: 'import', onDeckIdChange });
    return { reps, requests, alerts, input: document.getElementById('input'),
        button: document.getElementById('import'), click: () => document.getElementById('import').listeners.click[0]() };
}

test('ZIP ダウンロードは三つのバイナリ形式と空記録を扱い、生成中の連打を抑止する', async () => {
    const ui = exportHarness();
    assert.equal(ui.button.textContent, '导出诊断包');
    assert.equal(ui.status.hidden, true);
    const first = ui.click();
    assert.equal(ui.requests[0].name, 'exportImportDiagnostics');
    assert.equal(ui.button.disabled, true);
    assert.equal(ui.status.hidden, true);
    await ui.click();
    assert.equal(ui.requests.length, 1);
    ui.setLanguage('en');
    assert.equal(ui.button.textContent, strings.diagnostics_export_generating.en);
    ui.requests[0].resolve({ filename: 'report.zip', data: { type: 'Buffer', data: [80, 75, 3, 4] } });
    await first;
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.status.hidden, false);
    assert.equal(ui.status.textContent, strings.diagnostics_export_success.en);
    assert.equal(ui.blobs[0].type, 'application/zip');
    assert.deepEqual([...new Uint8Array(await ui.blobs[0].arrayBuffer())], [80, 75, 3, 4]);
    const anchor = ui.document.body.children[0];
    assert.equal(anchor.download, 'report.zip');
    assert.equal(anchor.clicked, true);
    assert.equal(anchor.removed, true);
    assert.equal(ui.revoked.length, 0);
    ui.timers.shift()();
    assert.equal(ui.revoked.length, 1);
    for (const [data, empty] of [
        [new Uint8Array([0, 80, 75, 3, 4, 0]).subarray(1, 5), true],
        [new Uint8Array([80, 75, 3, 4]).buffer, false]
    ]) {
        const promise = ui.click();
        ui.requests.at(-1).resolve({ filename: 'report.zip', data, empty });
        await promise;
        assert.deepEqual([...new Uint8Array(await ui.blobs.at(-1).arrayBuffer())], [80, 75, 3, 4]);
        assert.equal(ui.status.textContent, strings[empty ? 'diagnostics_export_empty' : 'diagnostics_export_success'].en);
    }
});

test('iframe は親ウィンドウの ArrayBuffer を ZIP として保存できる', async () => {
    const foreignBuffer = vm.runInNewContext('new Uint8Array([80, 75, 3, 4]).buffer');
    assert.equal(foreignBuffer instanceof ArrayBuffer, false);
    assert.equal(ArrayBuffer.isView(foreignBuffer), false);
    const foreignView = vm.runInNewContext('new Uint8Array([0, 80, 75, 3, 4, 0]).subarray(1, 5)');
    const foreignDataView = vm.runInNewContext('new DataView(new Uint8Array([0, 80, 75, 3, 4, 0]).buffer, 1, 4)');
    const ui = exportHarness();
    for (const data of [foreignBuffer, foreignView, foreignDataView]) {
        const promise = ui.click();
        ui.requests.at(-1).resolve({ filename: 'iframe-report.zip', data });
        await promise;
        assert.equal(ui.status.textContent, strings.diagnostics_export_success.chs);
        assert.equal(ui.button.disabled, false);
        assert.deepEqual([...new Uint8Array(await ui.blobs.at(-1).arrayBuffer())], [80, 75, 3, 4]);
        assert.equal(ui.document.body.children.at(-1).download, 'iframe-report.zip');
    }
});

test('ダウンロード失敗は再試行を許可し、表示言語をその場で更新する', async () => {
    const ui = exportHarness();
    const failure = ui.click();
    ui.requests.at(-1).reject(new Error('filesystem unavailable'));
    await failure;
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.status.textContent, strings.diagnostics_export_failed.chs);
    const malformed = ui.click();
    ui.requests.at(-1).resolve({ data: 'not binary' });
    await malformed;
    assert.equal(ui.blobs.length, 0);
    for (const language of ['jp', 'en', 'chs', 'cht']) {
        ui.setLanguage(language);
        assert.equal(ui.button.textContent, strings.diagnostics_export_button[language]);
        assert.equal(ui.status.textContent, strings.diagnostics_export_failed[language]);
    }
});

test('CHS の失敗は原因を保ち、警告は段階・カード・診断番号を示す', async () => {
    const successfulIds = [];
    const ui = importHarness({ onDeckIdChange: (code, result) => successfulIds.push([code, result]) });
    ui.input.value = ' deck-new ';
    ui.click();
    assert.equal(successfulIds.length, 0);
    assert.equal(ui.input.disabled, true);
    assert.equal(ui.requests[0].payload.code, 'deck-new');
    ui.click();
    assert.equal(ui.requests.length, 1);
    ui.requests[0].reject({ error: '卡组获取: TLS 错误\n单卡获取: ID 无效', diagnosticId: 'diagnostic-1', stack: 'internal traceback' });
    await flush();
    assert.equal(successfulIds.length, 0);
    assert.equal(ui.input.value, ' deck-new ');
    assert.equal(ui.input.disabled, false);
    for (const expected of ['TLS 错误', 'ID 无效', 'diagnostic-1', 'Settings']) assert.ok(ui.alerts[0].includes(expected));
    assert.equal(ui.alerts[0].includes('internal traceback'), false);
    ui.click();
    ui.requests.at(-1).resolve({ type: 'deck', diagnosticId: 'diagnostic-2',
        warnings: [{ message: '下载超时', stage: 'image.download', cardId: 'CS1-001' }],
        missingImages: ['CS1-001', 'CS1-002'], diagnosticsWarning: true });
    await flush();
    assert.equal(successfulIds.length, 1);
    assert.equal(successfulIds[0][0], 'deck-new');
    for (const expected of ['导入已完成', '卡图检查', 'CS1-002', 'diagnostic-2', '未能保存']) assert.ok(ui.alerts.at(-1).includes(expected));
    const warnings = ui.alerts.length;
    ui.click();
    ui.requests.at(-1).resolve({ type: 'deck', diagnosticId: 'diagnostic-3', warnings: [] });
    await flush();
    assert.equal(ui.alerts.length, warnings);
});

test('JP/CHT の成功応答と失敗通知を保ち、ビューアーでは成功時だけ入力を消す', async () => {
    for (const language of ['jp', 'cht']) {
        const successfulIds = [];
        const player = importHarness({ language, onDeckIdChange: code => successfulIds.push(code) });
        player.input.value = 'deck-code';
        player.click();
        player.requests.at(-1).resolve('Deck updated.');
        await flush();
        assert.deepEqual(successfulIds, ['deck-code']);
        player.click();
        player.requests.at(-1).reject(new Error('Exit code: 1'));
        await flush();
        assert.equal(player.alerts.at(-1), 'Failed to import: Exit code: 1');
        const viewer = importHarness({ language });
        viewer.input.value = 'card-code';
        viewer.click();
        viewer.requests.at(-1).reject(new Error('failed'));
        await flush();
        assert.equal(viewer.input.value, 'card-code');
        viewer.click();
        viewer.requests.at(-1).resolve('Card added.');
        await flush();
        assert.equal(viewer.input.value, '');
    }
});

test('JP/CHT/EN の診断付き失敗とゼロ終了の警告も Settings の案内と番号を表示する', async () => {
    for (const language of ['jp', 'cht', 'en']) {
        const ui = importHarness({ language });
        ui.input.value = 'card-code';
        ui.click();
        ui.requests.at(-1).reject({ error: 'RuntimeError: request failed', diagnosticId: `${language}-failure` });
        await flush();
        assert.ok(ui.alerts.at(-1).includes(`${language}-failure`));
        assert.ok(ui.alerts.at(-1).includes('RuntimeError: request failed'));
        assert.ok(ui.alerts.at(-1).includes(strings.import_diagnostics_help[language]));
        assert.equal(ui.input.value, 'card-code');
        ui.click();
        ui.requests.at(-1).resolve({ type: 'card', diagnosticId: `${language}-warning`, status: 'warning',
            warnings: [{ stage: 'database.save', message: 'PermissionError: denied', cardId: 'card-code' }] });
        await flush();
        assert.ok(ui.alerts.at(-1).includes(`${language}-warning`));
        assert.ok(ui.alerts.at(-1).includes('PermissionError: denied'));
        assert.equal(ui.input.value, '');
    }
});

test('実プレイヤーの成功コールバックは CHS 単カード追加でデッキ ID を変更しない', async () => {
    const document = makeDocument(), reps = new Map();
    let importer;
    const replicant = name => {
        if (!reps.has(name)) reps.set(name, {
            value: name === 'selections' ? [] : name === 'deckL' ? { cards: [] } : name === 'deckIdL' ? 'old-deck' : {}, on() {}
        });
        return reps.get(name);
    };
    const context = vm.createContext({ document, console, setTimeout, clearTimeout,
        nodecg: { Replicant: replicant }, NodeCG: { waitForReplicants: () => Promise.resolve() },
        setupDeckImporter: configuration => { importer = configuration; }, HotkeyManager: class { on() {} } });
    vm.runInContext(source('dashboard/js/player_panel.js'), context);
    context.setupPlayerPanel('L');
    await flush();
    assert.ok(importer);
    importer.onDeckIdChange('single-card', { type: 'card' });
    assert.equal(replicant('deckIdL').value, 'old-deck');
    importer.onDeckIdChange('new-deck', { type: 'deck' });
    assert.equal(replicant('deckIdL').value, 'new-deck');
    importer.onDeckIdChange('jp-deck', 'Deck updated.');
    assert.equal(replicant('deckIdL').value, 'jp-deck');
});

test('Settings のボタン隣接、スクリプト構文と四言語の診断キーを検証する', () => {
    const html = source('dashboard/setting.html');
    assert.match(html, /<button id="support-developer-btn"[^]*?<\/button>\s*<button id="export-import-diagnostics-btn"/);
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([^]*?)<\/script>/g)) new vm.Script(match[1]);
    for (const [key, entry] of Object.entries(strings).filter(([key]) => key.startsWith('diagnostics_') || key.startsWith('import_'))) {
        for (const language of ['jp', 'en', 'chs', 'cht']) assert.ok(entry[language], `${key}:${language}`);
    }
});
