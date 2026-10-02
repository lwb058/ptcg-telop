/**
 * Input: node:test, node:assert/strict, node:fs, node:os, node:path, node:child_process, ./legacy_import, ./import_diagnostics
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: Node.js テスト API、実 Python 子プロセス、legacy_import と診断ストアの ZIP 契約に依存する。
 * [OUTPUT]: JP/CHT/EN の例外・stdout エラー・ゼロ終了警告・フォールバックと状態更新の回帰を検証する。
 * [POS]: extension の従来言語境界テスト。一時 CLI と DB のみを使い、ネットワークとユーザー資源には触れない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createLegacyImporter } = require('./legacy_import');
const { createImportDiagnostics } = require('./import_diagnostics');

const PYTHON = process.env.PTCG_TEST_PYTHON || (os.platform() === 'win32' ? 'python' : 'python3');

function harness(t, language, { deckSource = '', cardSource = '', database = {} } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcg-legacy-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, `database_${language}.json`);
    fs.writeFileSync(databasePath, JSON.stringify(database));
    fs.writeFileSync(path.join(directory, `extract_deck_cards_${language}.py`), deckSource, 'utf8');
    fs.writeFileSync(path.join(directory, `get_single_card_${language}.py`), cardSource, 'utf8');
    const diagnostics = createImportDiagnostics({ logDir: path.join(directory, 'logs'), pythonCommand: PYTHON,
        bundleVersion: 'test', nodecg: { log: { warn() {} } } });
    const state = { deck: { name: 'old-deck', cards: ['old-card'] }, database, resetCount: 0, loading: [] };
    const importer = createLegacyImporter({ pythonDir: directory, pythonCommand: PYTHON, diagnostics,
        getSettings: () => ({ language }), databasePathFor: () => databasePath,
        getDatabase: () => state.database, getDeck: () => state.deck,
        reloadDatabase: () => { state.database = JSON.parse(fs.readFileSync(databasePath, 'utf8')); },
        commitDeck: (_side, code, cards) => { state.deck = { name: code, cards }; state.resetCount++; },
        onLoading: value => state.loading.push(value), reloadDelayMs: 0 });
    const events = () => fs.readFileSync(path.join(directory, 'logs/events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    return { importer, state, diagnostics, events };
}

test('全従来言語で実例外と stdout 失敗を同一番号で ZIP に保持する', async t => {
    for (const language of ['jp', 'cht', 'en']) {
        const h = harness(t, language, {
            deckSource: 'raise RuntimeError("deck connection failed https://user:secretPass@example.test/?token=secretToken")',
            cardSource: 'import sys; print("Failed to fetch card: card transport failed"); sys.exit(1)'
        });
        let failure;
        await assert.rejects(h.importer.run({ side: 'L', code: 'deck-or-card' }), error => {
            failure = error;
            return /deck:.*deck connection failed/.test(error.message) && /card:.*card transport failed/.test(error.message);
        });
        assert.deepEqual(h.state.deck, { name: 'old-deck', cards: ['old-card'] });
        assert.equal(h.state.resetCount, 0);
        assert.equal(h.state.loading.at(-1).loading, false);
        const archive = await h.diagnostics.exportArchive();
        const read = spawnSync(PYTHON, ['-c', 'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); sys.stdout.buffer.write(z.read("events.jsonl"))'],
            { input: archive.data, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        assert.equal(read.status, 0, read.stderr);
        assert.equal(read.stdout.includes('secretPass'), false);
        assert.equal(read.stdout.includes('secretToken'), false);
        const events = read.stdout.trim().split('\n').map(JSON.parse);
        assert.ok(events.every(event => event.language === language && event.diagnosticId === failure.diagnosticId));
        assert.ok(events.some(event => event.script === `extract_deck_cards_${language}.py` && /Traceback/.test(event.message || '')));
        assert.ok(events.some(event => event.script === `get_single_card_${language}.py` && event.stage === 'process.stdout' && /card transport failed/.test(event.message)));
        const exits = events.filter(event => event.stage === 'process.exit');
        assert.deepEqual(exits.map(event => event.exitCode), [1, 1]);
        assert.deepEqual(exits.map(event => event.attemptType), ['deck', 'card']);
    }
});

test('ゼロ終了したデッキの内部例外はカード・段階・警告を保ちながら既存形式を更新する', async t => {
    const h = harness(t, 'jp', { deckSource: [
        'import json,sys',
        'sys.stderr.write("--- Processing card 1/2: JP-001\\n")',
        'sys.stderr.write("PTCG_DIAG " + json.dumps({"stage":"image.download","event":"failed","cardId":"JP-001","message":"image request failed","traceback":"RuntimeError: image request failed"}) + "\\n")',
        'print(json.dumps({"cards":["JP-001","JP-002"]}))'
    ].join('\n') });
    const result = await h.importer.run({ side: 'R', code: 'new-deck', progressOptions: { scale: 0.5, offset: 20 } });
    assert.equal(result.type, 'deck');
    assert.equal(result.status, 'warning');
    assert.ok(result.warnings.some(warning => warning.cardId === 'JP-001' && warning.stage === 'image.download'));
    assert.deepEqual(h.state.deck, { name: 'new-deck', cards: ['JP-001', 'JP-002'] });
    assert.equal(h.state.resetCount, 1);
    assert.ok(h.state.loading.some(value => value.percentage === 45));
    const events = h.events();
    assert.ok(events.some(event => event.traceback === 'RuntimeError: image request failed' && event.script === 'extract_deck_cards_jp.py'));
    assert.ok(events.some(event => event.stage === 'process.exit' && event.exitCode === 0));
});

test('単カードのキャッシュフォールバックは取得失敗を残し、デッキ名とサイドを維持する', async t => {
    const h = harness(t, 'cht', { deckSource: 'raise ValueError("not a deck")', database: { 'CHT-001': { name: 'cached' } } });
    const result = await h.importer.run({ side: 'L', code: 'CHT/001' });
    assert.equal(result.type, 'card');
    assert.equal(result.status, 'success');
    assert.deepEqual(h.state.deck, { name: 'old-deck', cards: ['old-card', 'CHT-001'] });
    assert.equal(h.state.resetCount, 0);
    const events = h.events();
    assert.equal(events.filter(event => event.stage === 'process.spawn').length, 1);
    assert.ok(events.some(event => event.stage === 'import.attempt' && /not a deck/.test(event.message)));
    assert.ok(events.every(event => event.diagnosticId === result.diagnosticId));
});

test('単カード stdout のエラーがゼロ終了でも失われず、DB 保存失敗の原因に使われる', async t => {
    const h = harness(t, 'cht', { deckSource: 'raise ValueError("not a deck")', cardSource: 'print("Error saving card: PermissionError denied")' });
    await assert.rejects(h.importer.run({ side: 'L', code: 'CHT-001' }), error => /PermissionError denied/.test(error.message));
    assert.deepEqual(h.state.deck, { name: 'old-deck', cards: ['old-card'] });
    assert.ok(h.events().some(event => event.stage === 'process.stdout' && /PermissionError denied/.test(event.message)));
    assert.ok(h.events().some(event => event.script === 'get_single_card_cht.py' && event.stage === 'process.exit' && event.exitCode === 0));
});

test('取得済み単カードの警告付き成功は新 DB を読み、デッキ名とサイドを維持する', async t => {
    const h = harness(t, 'jp', { deckSource: 'raise ValueError("not a deck")', cardSource: [
        'import json,sys',
        'p=sys.argv[sys.argv.index("--database-path")+1]',
        'with open(p,"w",encoding="utf-8") as f: json.dump({sys.argv[1]:{"name":"new card"}},f)',
        'sys.stderr.write("PTCG_DIAG " + json.dumps({"stage":"image.download","event":"failed","cardId":sys.argv[1],"message":"image unavailable"}) + "\\n")'
    ].join('\n') });
    const result = await h.importer.run({ side: 'L', code: 'JP/003' });
    assert.equal(result.type, 'card');
    assert.equal(result.status, 'warning');
    assert.ok(result.warnings.some(warning => warning.message === 'image unavailable'));
    assert.deepEqual(h.state.deck, { name: 'old-deck', cards: ['old-card', 'JP-003'] });
    assert.equal(h.state.database['JP-003'].name, 'new card');
    assert.equal(h.state.resetCount, 0);
});

test('タイムラインのデッキ専用取得は英語予約 CLI の空結果を診断し、単カードを試さない', async t => {
    const h = harness(t, 'en');
    await assert.rejects(h.importer.run({ side: 'L', code: 'en-deck', allowCardFallback: false }), error => !!error.diagnosticId);
    const events = h.events();
    assert.equal(events.filter(event => event.stage === 'process.spawn').length, 1);
    assert.ok(events.some(event => event.script === 'extract_deck_cards_en.py' && event.stage === 'process.output' && event.event === 'failed'));
    assert.ok(events.every(event => event.language === 'en'));
    assert.equal(h.state.resetCount, 0);
    assert.deepEqual(h.state.deck, { name: 'old-deck', cards: ['old-card'] });
});
