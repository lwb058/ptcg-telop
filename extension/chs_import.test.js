/**
 * Input: node:test, node:assert/strict, fs, os, path, ./chs_import, ./import_diagnostics
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: 実際の Python 子プロセス、テンポラリ DB、chs_import と診断ストアに依存する。
 * [OUTPUT]: 原因保持、UTF-8、完全性、期限、状態保護の再現可能な Node テストを提供する。
 * [POS]: extension の CHS 統合境界テスト。通信なしで Python の実終了と保存結果を検証する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createChsImporter } = require('./chs_import');
const { createImportDiagnostics } = require('./import_diagnostics');

const PYTHON = process.env.PTCG_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const FIXTURE = `import os,sys,json,time
code=sys.argv[1]
if code=='real-cli':
    import import_diagnostics as diagnostics
    def real_failure():
        raise RuntimeError('实际 CLI 原始异常')
    diagnostics.run_cli(real_failure)
deck='extract_deck' in os.path.basename(sys.argv[0])
dbpath=sys.argv[sys.argv.index('--database-path')+1]
def emit(stage,event,**fields):
    print('PTCG_DIAG '+json.dumps(dict(stage=stage,event=event,**fields),ensure_ascii=False),file=sys.stderr,flush=True)
def result(**fields):
    value=dict(cards=['A-1'],missingCards=[],missingImages=[],warnings=[],databaseSaved=True,status='success')
    value.update(fields)
    emit('result',value['status'],missingCards=value['missingCards'],missingImages=value['missingImages'],databaseSaved=value['databaseSaved'])
    print(json.dumps(value,ensure_ascii=False),flush=True)
if code in ('slow','budget','language'):
    emit('card.fetch','started')
    time.sleep(5 if code=='slow' else .16)
if code=='uncaught':
    raise RuntimeError('未捕获的中文异常')
if code=='long-stderr':
    os.write(2,('HEAD'+'x'*100000+'RuntimeError: 超长行尾部异常\\n'+'START'+'y'*100000+'RuntimeError: 无换行尾部异常').encode('utf-8'))
    sys.exit(1)
if code in ('dual-fail','unicode','url-fail') or (code in ('card-only','budget') and deck):
    message='原始卡组网络失败' if deck else '第二次单卡解析失败'
    if code=='url-fail':
        message+=' https://demo:fixture-pass@proxy.invalid/?token=fixture-token'
    if code=='unicode':
        raw=('PTCG_DIAG '+json.dumps(dict(stage='card.fetch',event='failed',message='中文分片异常',cardId='A-1'),ensure_ascii=False)).encode('utf-8')
        index=raw.index('中文'.encode('utf-8'))+1
        os.write(2,raw[:index]);time.sleep(.02);os.write(2,raw[index:])
    else:
        emit('deck.fetch' if deck else 'card.parse','failed',errorType='ValueError',message=message,traceback='ValueError: '+message)
    result(cards=[],missingCards=[] if deck else ['A-1','B-2'],databaseSaved=False,status='failed')
    sys.exit(1)
if not deck and code not in ('card-only','budget'):
    emit('input','failed',errorType='ValueError',message='不是单卡 ID')
    result(cards=[],databaseSaved=False,status='failed');sys.exit(1)
if code=='malformed':
    print('invalid business JSON');sys.exit(0)
database={'OLD-1':{'name':'旧卡'},'A-1':{'name':'新卡'}}
with open(dbpath,'w',encoding='utf-8') as f:
    f.write('{bad database' if code=='bad-db' else json.dumps(database,ensure_ascii=False))
if code=='missing':
    emit('card.fetch','failed',errorType='ConnectionError',message='B-2 连接失败',cardId='B-2')
    result(cards=['A-1','B-2'],missingCards=['B-2'],status='failed')
elif code=='save-failure':
    emit('database.save','failed',errorType='PermissionError',message='数据库不能写入')
    result(databaseSaved=False,status='failed')
elif code=='warning':
    emit('image.download','failed',errorType='ReadTimeout',message='卡图读取超时',cardId='A-1')
    emit('image.download','warning',message='卡图不可用',cardId='A-1')
    result(missingImages=['A-1'],warnings=[dict(stage='image.download',cardId='A-1',message='卡图不可用')],status='warning')
elif code=='bad-warning':
    result(warnings=[None])
else:
    result()
`;

function setup(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcg-chs-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    for (const name of ['extract_deck_cards_chs.py', 'get_single_card_chs.py']) fs.writeFileSync(path.join(directory, name), FIXTURE);
    fs.copyFileSync(path.join(__dirname, '..', 'python', 'import_diagnostics.py'), path.join(directory, 'import_diagnostics.py'));
    const databasePath = path.join(directory, 'database.json');
    fs.writeFileSync(databasePath, JSON.stringify({ 'OLD-1': { name: '旧卡' } }));
    const state = { database: { 'OLD-1': { name: '旧卡' } }, deck: { name: 'old', cards: ['OLD-1'] }, id: 'old', prizes: ['OLD-1'] };
    const original = structuredClone(state);
    const settings = { language: 'chs', forceRefetchDeck: false };
    const events = [], loading = [];
    if (options.unwritableDiagnostics) fs.writeFileSync(path.join(directory, 'logs'), 'blocked');
    const store = createImportDiagnostics({ logDir: path.join(directory, 'logs'), bundleVersion: 'test',
        pythonCommand: PYTHON, nodecg: { log: { warn() {}, info() {}, error() {} } } });
    const diagnostics = { ...store, record(context, event) { events.push({ id: context.id, ...event }); store.record(context, event); } };
    const importer = createChsImporter({ pythonDir: directory, databasePath, pythonCommand: PYTHON, diagnostics,
        getSettings: () => settings, onLoading: value => loading.push(value),
        commit: ({ type, code, cards, database }) => {
            state.database = database;
            state.deck = type === 'deck' ? { name: code, cards } : { ...state.deck, cards: [...state.deck.cards, ...cards] };
            if (type === 'deck') { state.id = code; state.prizes = []; }
        }, ...options });
    return { importer, state, original, events, loading, settings, store };
}

test('caught deck and card failures keep both reasons and one diagnostic ID without changing loaded state', async t => {
    const f = setup(t);
    await assert.rejects(f.importer.run({ side: 'L', code: 'dual-fail' }), error => {
        assert.match(error.message, /卡组尝试.*原始卡组网络失败/);
        assert.match(error.message, /单卡尝试.*第二次单卡解析失败/);
        assert.ok(error.diagnosticId);
        assert.ok(f.events.every(event => event.id === error.diagnosticId));
        return true;
    });
    assert.deepEqual(f.state, f.original);
    assert.equal(f.loading.at(-1).loading, false);
    assert.ok(f.events.some(event => event.traceback && event.attemptType === 'deck'));
    assert.ok(f.events.some(event => event.exitCode === 1));
    const exits = f.events.filter(event => event.stage === 'process.exit');
    assert.deepEqual(exits.map(event => [event.script, event.attempt, event.event]), [
        ['extract_deck_cards_chs.py', 1, 'failed'], ['get_single_card_chs.py', 2, 'failed']
    ]);
    assert.equal(f.events.filter(event => event.stage === 'process.spawn').length, 2);
});

test('oversized CHS stderr preserves both line tails and explicit truncation without losing the failure reason', async t => {
    const f = setup(t);
    await assert.rejects(f.importer.run({ side: 'L', code: 'long-stderr' }), error => error.message.includes('无换行尾部异常'));
    const output = f.events.filter(event => event.event === 'stderr');
    assert.equal(output.length, 4);
    assert.ok(output.every(event => event.truncated && event.omittedChars > 90000 && event.message.length < 8100));
    assert.ok(output.some(event => event.message.endsWith('RuntimeError: 超长行尾部异常')));
    assert.ok(output.some(event => event.message.endsWith('RuntimeError: 无换行尾部异常')));
    assert.deepEqual(f.state, f.original);
});

test('uncaught Python traceback survives stderr fallback and UTF-8 remains intact across chunks without final newline', async t => {
    const f = setup(t);
    await assert.rejects(f.importer.run({ side: 'L', code: 'uncaught' }), error => error.message.includes('RuntimeError: 未捕获的中文异常'));
    await assert.rejects(f.importer.run({ side: 'L', code: 'unicode' }), error => error.message.includes('中文分片异常') && !error.message.includes('�'));
    assert.ok(f.events.some(event => event.event === 'stderr' && event.message.includes('Traceback')));
    assert.deepEqual(f.state, f.original);
});

test('real Python CLI final result event cannot overwrite the original exception', async t => {
    const f = setup(t);
    await assert.rejects(f.importer.run({ side: 'L', code: 'real-cli' }), error =>
        error.message.includes('实际 CLI 原始异常') && !error.message.includes('未知异常'));
    assert.ok(f.events.some(event => event.stage === 'result' && event.event === 'failed'));
    assert.ok(f.events.some(event => event.errorType === 'RuntimeError' && event.traceback.includes('real_failure')));
    assert.deepEqual(f.state, f.original);
});

test('URL credential redaction cannot swallow missing card IDs or the second attempt cause', async t => {
    const f = setup(t);
    await assert.rejects(f.importer.run({ side: 'L', code: 'url-fail' }), error => {
        assert.match(error.message, /原始卡组网络失败/);
        assert.match(error.message, /第二次单卡解析失败/);
        assert.match(error.message, /缺少卡牌资料：A-1、B-2/);
        assert.ok(!error.message.includes('fixture-pass') && !error.message.includes('fixture-token'));
        return true;
    });
    assert.deepEqual(f.state, f.original);
});

test('exit zero image failures produce warning import while card data commits', async t => {
    const f = setup(t);
    const result = await f.importer.run({ side: 'L', code: 'warning' });
    assert.equal(result.status, 'warning');
    assert.deepEqual(result.missingImages, ['A-1']);
    assert.equal(result.warnings[0].cardId, 'A-1');
    assert.equal(f.state.id, 'warning');
    assert.equal(f.state.database['A-1'].name, '新卡');
    assert.ok(f.events.some(event => event.stage === 'image.download' && event.event === 'failed'));
});

test('unwritable diagnostic directory cannot prevent a complete card data import', async t => {
    const f = setup(t, { unwritableDiagnostics: true });
    const result = await f.importer.run({ side: 'L', code: 'success' });
    assert.equal(result.status, 'warning');
    assert.ok(result.diagnosticsWarning);
    assert.equal(f.state.id, 'success');
    assert.equal(f.state.database['A-1'].name, '新卡');
});

test('missing card data, bad DB, save failure and malformed stdout cannot replace previous state', async t => {
    const f = setup(t);
    for (const code of ['missing', 'bad-db', 'save-failure', 'malformed', 'bad-warning']) {
        await assert.rejects(f.importer.run({ side: 'R', code }), error => {
            if (code === 'missing') assert.match(error.message, /B-2 连接失败/);
            if (code === 'bad-db') assert.match(error.message, /重载数据库/);
            if (code === 'save-failure') assert.match(error.message, /数据库不能写入/);
            return true;
        });
        assert.deepEqual(f.state, f.original);
    }
});

test('single card fallback keeps prior deck ID and prizes; deck-only caller does not fallback', async t => {
    const f = setup(t);
    const result = await f.importer.run({ side: 'L', code: 'card-only' });
    assert.equal(result.type, 'card');
    assert.equal(f.state.id, f.original.id);
    assert.deepEqual(f.state.prizes, f.original.prizes);
    assert.deepEqual(f.state.deck.cards, ['OLD-1', 'A-1']);
    await assert.rejects(f.importer.run({ side: 'L', code: 'card-only', allowCardFallback: false }));
    assert.equal(f.events.filter(event => event.attemptType === 'card' && event.stage === 'process.spawn').length, 1);
});

test('total deadline kills subprocess, disallows late commits, and concurrent requests cannot unlock the active job', async t => {
    const f = setup(t, { totalTimeoutMs: 200 });
    const active = f.importer.run({ side: 'L', code: 'slow' });
    await assert.rejects(f.importer.run({ side: 'R', code: 'warning' }), error => error.message.includes('已有导入'));
    assert.equal(f.importer.isBusy(), true);
    await assert.rejects(active, error => error.message.includes('超时'));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(f.state, f.original);
    assert.equal(f.importer.isBusy(), false);
    assert.ok(f.events.some(event => event.stage === 'process.timeout'));
});

test('deck and card attempts share the same total deadline', async t => {
    const f = setup(t, { totalTimeoutMs: 260 });
    await assert.rejects(f.importer.run({ side: 'L', code: 'budget' }), error => error.message.includes('超时'));
    assert.deepEqual(f.state, f.original);
});

test('changing language during Python execution rejects the candidate before commit', async t => {
    const f = setup(t);
    const promise = f.importer.run({ side: 'L', code: 'language' });
    f.settings.language = 'jp';
    await assert.rejects(promise, error => error.message.includes('语言已更改'));
    assert.deepEqual(f.state, f.original);
});

test('spawn errors and invalid input have useful failures, and later jobs are available', async t => {
    const f = setup(t, { pythonCommand: 'ptcg-nonexistent-python-command' });
    await assert.rejects(f.importer.run({ side: 'L', code: 'warning' }), error => error.message.includes('启动 Python'));
    await assert.rejects(f.importer.run({ side: 'X', code: '' }), error => error.message.includes('输入处理'));
    assert.equal(f.importer.isBusy(), false);
});
