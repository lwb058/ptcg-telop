/**
 * Input: node:test, node:assert/strict, child_process, ./python_process
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: 実 Python、Node テスト API、共通 Python 起動器と注入用診断保存器に依存する。
 * [OUTPUT]: 起動・終了・例外・出力境界を通信なしで検証する統合テストを提供する。
 * [POS]: extension の子プロセス取証テスト。既存ストリームの維持と診断障害の隔離を検証する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChildProcess, spawn } = require('child_process');
const { spawnPython } = require('./python_process');

const PYTHON = process.env.PTCG_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

async function execute(source, options = {}) {
    const events = [], chunks = [];
    const context = { id: 'fixture-diagnostic' };
    const child = spawnPython({ command: PYTHON, args: ['-c', source], context,
        options: { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } },
        diagnostics: { record(_context, event) { assert.equal(_context, context); events.push(event); } }, ...options });
    assert.ok(child instanceof ChildProcess);
    child.stdout.on('data', chunk => chunks.push(chunk));
    const result = await new Promise(resolve => {
        let error;
        child.on('error', value => { error = value; });
        child.on('close', (code, signal) => resolve({ code, signal, error }));
    });
    return { child, events, stdout: Buffer.concat(chunks), ...result };
}

test('real SyntaxError, missing dependency and uncaught traceback preserve original errors and failed exit', async () => {
    for (const [source, expected] of [['def broken(:', 'SyntaxError'],
        ['import ptcg_nonexistent_dependency', 'ModuleNotFoundError'],
        ['raise ValueError("実例の例外")', 'ValueError: 実例の例外']]) {
        const result = await execute(source);
        assert.notEqual(result.code, 0);
        assert.ok(result.events.some(event => event.stage === 'process.stderr' && event.message.includes(expected)));
        assert.equal(result.events.at(-1).event, 'failed');
        assert.equal(result.events.at(-1).script, '-c');
    }
});

test('legacy stdout errors are captured only when requested and business listeners still receive identical bytes', async () => {
    const source = 'import sys; print("Error: 單卡取得失敗"); sys.exit(1)';
    const result = await execute(source, { captureStdout: true });
    assert.equal(result.stdout.toString('utf8').trim(), 'Error: 單卡取得失敗');
    assert.ok(result.events.some(event => event.stage === 'process.stdout' && event.message.includes('單卡取得失敗')));
    const unobserved = await execute(source);
    assert.ok(!unobserved.events.some(event => event.stage === 'process.stdout'));
});

test('caught exceptions on stderr are retained even when Python exits successfully', async () => {
    const result = await execute('import traceback\ntry: raise RuntimeError("取得処理が失敗")\nexcept: traceback.print_exc()');
    assert.equal(result.code, 0);
    assert.ok(result.events.some(event => event.message && event.message.includes('RuntimeError: 取得処理が失敗')));
    assert.equal(result.events.at(-1).event, 'finished');
});

test('UTF-8 split across chunks and the unterminated final line remain intact', async () => {
    const result = await execute('import os,time\nraw="中文分片異常".encode("utf-8")\nos.write(2,raw[:1]);time.sleep(.03);os.write(2,raw[1:])');
    const output = result.events.filter(event => event.stage === 'process.stderr');
    assert.equal(output.length, 1);
    assert.equal(output[0].message, '中文分片異常');
});

test('inherited regional encoding cannot corrupt early Python stdout and exception evidence', async () => {
    const result = await execute('import sys; print("日本の出力"); raise RuntimeError("日本例外")', {
        captureStdout: true, options: { env: { ...process.env, PYTHONIOENCODING: 'cp932' } }
    });
    assert.equal(result.stdout.toString('utf8').trim(), '日本の出力');
    assert.ok(result.events.some(event => event.message === 'RuntimeError: 日本例外'));
    assert.ok(!result.events.some(event => (event.message || '').includes('\uFFFD')));
});

test('pipe read failures are recorded even when text observation is disabled', async () => {
    for (const stream of ['stdout', 'stderr']) {
        const result = await execute('import time; time.sleep(.1)', {
            recordStderr: false, captureStdout: false,
            spawnProcess(...args) {
                const child = spawn(...args);
                child.on('spawn', () => child[stream].destroy(new Error(`${stream} fixture read failure`)));
                return child;
            }
        });
        assert.ok(result.events.some(event => event.stage === `process.${stream}` && event.event === 'failed' &&
            event.message === `${stream} fixture read failure` && event.stack));
    }
});

test('large newline and unterminated lines retain their tails and explicit truncation metadata', async () => {
    const result = await execute('import os\nos.write(2,("HEAD"+"x"*100000+"TAIL\\n"+"START"+"y"*100000+"END").encode())');
    const output = result.events.filter(event => event.stage === 'process.stderr');
    assert.equal(output.length, 2);
    assert.match(output[0].message, /^HEAD.*\[TRUNCATED \d+ chars\].*TAIL$/);
    assert.match(output[1].message, /^START.*\[TRUNCATED \d+ chars\].*END$/);
    assert.ok(output.every(event => event.truncated && event.omittedChars > 90000 && event.message.length < 8100));
});

test('structured events retain stages while trusted script and attempt identities override payloads', async () => {
    const result = await execute('import sys,json\nprint("PTCG_DIAG "+json.dumps(dict(stage="card.fetch",event="failed",message="network error",script="forged.py",attempt=999,operation="forged")),file=sys.stderr)\nprint("PTCG_DIAG malformed",file=sys.stderr)',
        { details: { attempt: 2, attemptType: 'card', operation: 'import.card' } });
    const event = result.events.find(item => item.stage === 'card.fetch');
    assert.equal(event.script, '-c');
    assert.equal(event.attempt, 2);
    assert.equal(event.attemptType, 'card');
    assert.equal(event.operation, 'import.card');
    assert.ok(result.events.some(item => item.message === 'PTCG_DIAG malformed'));
});

test('command startup errors and synchronous spawn failures preserve caller error contracts', async () => {
    const result = await execute('', { command: 'ptcg-nonexistent-python-command' });
    assert.equal(result.error.code, 'ENOENT');
    assert.ok(result.events.some(event => event.stage === 'process.error' && event.code === 'ENOENT' && event.stack));
    assert.equal(result.events.at(-1).event, 'failed');
    const events = [], original = new Error('sync spawn failure');
    assert.throws(() => spawnPython({ command: PYTHON, args: ['-c', ''], diagnostics: { record(_context, event) { events.push(event); } },
        spawnProcess() { throw original; } }), error => error === original);
    assert.equal(events.at(-1).stage, 'process.error');
});

test('signal termination is recorded as failure without replacing the actual ChildProcess', async () => {
    let actual;
    const result = await execute('import time;time.sleep(30)', { spawnProcess(...args) {
        actual = spawn(...args);
        actual.on('spawn', () => actual.kill('SIGKILL'));
        return actual;
    } });
    assert.equal(result.child, actual);
    assert.ok(result.signal || result.code !== 0);
    assert.equal(result.events.at(-1).event, 'failed');
});

test('binary ZIP stdout is untouched and never becomes a diagnostic text event', async () => {
    const result = await execute('import os;os.write(1,b"PK\\x03\\x04\\x00\\xff\\x00\\x80")');
    assert.deepEqual(result.stdout, Buffer.from([80, 75, 3, 4, 0, 255, 0, 128]));
    assert.ok(result.events.every(event => !event.message));
});

test('broken diagnostic recorders and disabled stderr observation cannot interfere with Python business output', async () => {
    const result = await execute('import sys;print("result");print("warning",file=sys.stderr)',
        { diagnostics: { record() { throw new Error('broken storage'); } } });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString().trim(), 'result');
    const quiet = await execute('import sys;print("hidden",file=sys.stderr)', { recordStderr: false });
    assert.deepEqual(quiet.events.map(event => event.stage), ['process.spawn', 'process.exit']);
});
