/**
 * Input: node:test, node:assert/strict, fs, os, path, child_process, ./import_diagnostics
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: Node.js のテスト・一時ファイル API、Python 標準 ZIP 読取と import_diagnostics の公開契約に依存する。
 * [OUTPUT]: 全言語・内部 Python の障害保持、匿名化、再起動、容量・期限と不変 ZIP スナップショットを検証する。
 * [POS]: 診断ストアの回帰テスト。実 Python へ障害を注入し、ユーザーの設定や実ログを読まず一時ディレクトリだけを使用する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createImportDiagnostics, redactText } = require('./import_diagnostics');

const PYTHON = os.platform() === 'win32' ? 'python' : 'python3';
const ZIP_READER = 'import io,json,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:z.read(n).decode("utf-8") for n in z.namelist()}))';

function temporaryDirectory(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptcg-diagnostics-test-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function makeStore(logDir, extra = {}) {
	return createImportDiagnostics({ logDir, nodecg: { version: '2.6.4', log: { warn() {} } }, bundleVersion: 'test-version', pythonCommand: PYTHON, ...extra });
}

async function readArchive(store) {
	const archive = await store.exportArchive();
	assert.match(archive.filename, /^ptcg-telop-diagnostics-.+\.zip$/);
	assert.equal(archive.data.subarray(0, 2).toString(), 'PK');
	const read = spawnSync(PYTHON, ['-c', ZIP_READER], { input: archive.data, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
	assert.equal(read.status, 0, read.stderr);
	const files = JSON.parse(read.stdout);
	assert.deepEqual(Object.keys(files).sort(), ['environment.json', 'events.jsonl', 'summary.txt']);
	return { files, events: files['events.jsonl'].trim() ? files['events.jsonl'].trim().split('\n').map(line => JSON.parse(line)) : [] };
}

test('Python ZIP contains sanitized Unicode records and an allowlisted environment', async t => {
	const directory = temporaryDirectory(t);
	const store = makeStore(directory);
	const context = store.begin({ input: '普通卡组代码-CSV5C', side: 'L' });
	const error = new Error('连接失败 https://secretUser:secretPassword@tcg.mik.moe/card?token=secretQuery&deck=normalCode');
	error.cause = new Error('Authorization: Bearer secretBearer; password="secretField"; C:\\Users\\privatePerson\\cards.json /home/privateLinux/file');
	store.record(context, {
		stage: 'card_fetch', status: 'failed', cardId: 'CSV5C-075', exception: error,
		nested: { apiKey: 'secretApiKey', 'proxy-authorization': 'secretProxy', password: 'secretNested', auth: 'secretAuth', proxyCredentials: 'secretCredentials' },
		responseBody: 'secretBody must not be copied', message: '请求失败：证据保留'
	});
	const persisted = fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8');
	const { files, events } = await readArchive(store);
	for (const secret of ['secretUser', 'secretPassword', 'secretQuery', 'secretBearer', 'secretField', 'privatePerson', 'privateLinux', 'secretApiKey', 'secretProxy', 'secretNested', 'secretAuth', 'secretCredentials', 'secretBody']) {
		assert.equal(persisted.includes(secret), false, secret);
		assert.equal(Object.values(files).join('\n').includes(secret), false, secret);
	}
	assert.equal(events[1].diagnosticId, context.id);
	assert.equal(events[1].cardId, 'CSV5C-075');
	assert.equal(events[1].input, '普通卡组代码-CSV5C');
	assert.equal(events[1].exception.cause.name, 'Error');
	assert.equal(events[1].responseBody.omitted, true);
	assert.match(persisted, /请求失败：证据保留/);
	const environment = JSON.parse(files['environment.json']);
	assert.deepEqual(Object.keys(environment).sort(), ['architecture', 'bundleVersion', 'diagnosticLanguages', 'nodeVersion', 'nodecgVersion', 'platform', 'proxyConfigured', 'pythonVersion', 'timeouts']);
	assert.deepEqual(environment.diagnosticLanguages, ['jp', 'chs', 'cht', 'en', 'runtime']);
	assert.match(environment.pythonVersion, /^\d+\.\d+\.\d+$/);
	assert.equal(typeof environment.proxyConfigured, 'boolean');
	assert.equal(environment.nodecgVersion, '2.6.4');
	assert.deepEqual(environment.timeouts, { chs: { connectSeconds: 10, readSeconds: 30, importSeconds: 600 },
		versionProbeMs: 5000, archiveMs: 30000 });
});

test('retention expires old events and survives a store restart', async t => {
	const directory = temporaryDirectory(t);
	let time = Date.parse('2026-10-01T00:00:00Z');
	const store = makeStore(directory, { now: () => time });
	const old = store.begin({ input: 'old-deck', side: 'L' });
	store.record(old, { stage: 'import', status: 'failed', message: 'old failure' });
	time += 8 * 86400000;
	const fresh = store.begin({ input: 'fresh-deck', side: 'R' });
	store.record(fresh, { stage: 'import', status: 'completed' });
	const restarted = makeStore(directory, { now: () => time });
	const { files, events } = await readArchive(restarted);
	assert.equal(events.length, 2);
	assert.ok(events.every(event => event.diagnosticId === fresh.id));
	assert.match(files['summary.txt'], /Removed events: 2/);
	assert.equal(files['events.jsonl'].includes('old-deck'), false);
});

test('capacity includes the active file and metadata, and truncation is explicit', async t => {
	const directory = temporaryDirectory(t);
	const maxBytes = 2200;
	const store = makeStore(directory, { maxBytes });
	const context = store.begin({ input: 'deck-code', side: 'L' });
	for (let index = 0; index < 20; index++) store.record(context, { stage: 'fetch', status: 'completed', index, message: 'x'.repeat(80) });
	store.record(context, { stage: 'import', status: 'failed', message: '错误'.repeat(20000), exception: new Error('x'.repeat(20000)) });
	const totalBytes = fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
	assert.ok(totalBytes <= maxBytes, `stored ${totalBytes} bytes`);
	const restarted = makeStore(directory, { maxBytes });
	const { files, events } = await readArchive(restarted);
	assert.ok(events.length < 22);
	assert.equal(events.at(-1).truncated, true);
	assert.equal(events.at(-1).status, 'failed');
	assert.match(files['summary.txt'], /Removed events: [1-9]\d*/);
	assert.match(files['summary.txt'], /Truncated events: 1/);
});

test('an unwritable diagnostics path cannot block imports and exports an explicit warning', async t => {
	const directory = temporaryDirectory(t);
	const blocked = path.join(directory, 'a-file');
	fs.writeFileSync(blocked, 'fixture');
	const warnings = [];
	const store = makeStore(path.join(blocked, 'logs'), { nodecg: { log: { warn(message) { warnings.push(message); } } } });
	let context;
	assert.doesNotThrow(() => { context = store.begin({ input: 'ordinary-input', side: 'R' }); });
	assert.doesNotThrow(() => store.record(context, { stage: 'import', status: 'completed' }));
	assert.ok(store.getWarning());
	assert.ok(warnings.length > 0);
	assert.equal(warnings.join('').includes(blocked), false);
	const { files, events } = await readArchive(store);
	assert.equal(events.at(-1).status, 'completed');
	assert.match(files['summary.txt'], /Some records may not have been saved/);
});

test('empty exports and concurrent exports use one immutable snapshot', async t => {
	const store = makeStore(temporaryDirectory(t));
	const empty = await readArchive(store);
	assert.equal(empty.events.length, 0);
	assert.match(empty.files['summary.txt'], /No retained records/);
	const first = store.exportArchive();
	assert.equal(store.exportArchive(), first);
	store.begin({ input: 'arrived-after-snapshot', side: 'L' });
	const archive = await first;
	assert.equal(archive.empty, true);
	const read = spawnSync(PYTHON, ['-c', ZIP_READER], { input: archive.data, encoding: 'utf8' });
	assert.equal(read.status, 0, read.stderr);
	assert.equal(JSON.parse(read.stdout)['events.jsonl'], '');
	assert.equal((await readArchive(store)).events.length, 1);
});

test('damaged metadata does not erase valid records, and malformed events are disclosed', async t => {
	const directory = temporaryDirectory(t);
	const store = makeStore(directory);
	const context = store.begin({ input: 'valid-deck', side: 'L' });
	fs.writeFileSync(path.join(directory, 'retention.json'), 'not JSON');
	fs.appendFileSync(path.join(directory, 'events.jsonl'), '{broken line\n');
	const restarted = makeStore(directory);
	const { files, events } = await readArchive(restarted);
	assert.equal(events[0].diagnosticId, context.id);
	assert.match(files['summary.txt'], /Unreadable events: 2/);
});

test('ZIP generator rejects arbitrary member paths and Python startup failures are clear', async t => {
	const store = makeStore(temporaryDirectory(t), { pythonCommand: 'ptcg-missing-python-test-command', exportTimeoutMs: 1000 });
	await assert.rejects(store.exportArchive(), /Python/);
	const script = path.join(__dirname, '..', 'python', 'export_diagnostics.py');
	const run = spawnSync(PYTHON, [script], { input: JSON.stringify({ '../cfg/secrets.json': 'value' }), encoding: 'utf8' });
	assert.equal(run.status, 1);
	assert.equal(run.stdout, '');
	assert.equal(run.stderr.includes('secrets'), false);
});

test('startup recovers the newest complete records from an oversized store', async t => {
	const directory = temporaryDirectory(t);
	const source = makeStore(directory);
	for (let index = 0; index < 30; index++) source.begin({ input: 'deck-' + index, side: 'L' });
	const limited = makeStore(directory, { maxBytes: 1800 });
	const { files, events } = await readArchive(limited);
	assert.equal(events.at(-1).input, 'deck-29');
	assert.ok(events.length < 30);
	assert.match(files['summary.txt'], /Recovered oversized files: 1/);
	const totalBytes = fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
	assert.ok(totalBytes <= 1800);
});

test('shared text redaction preserves ordinary deck URLs while removing sensitive parameters', () => {
	const text = redactText('https://tcg.mik.moe/deck?code=ABC-123&api_key=hidden#access_token=fragmentHidden');
	assert.match(text, /code=ABC-123/);
	assert.equal(text.includes('hidden'), false);
	assert.equal(text.includes('fragmentHidden'), false);
	const escapedPath = redactText(String.raw`FileNotFoundError: 'C:\\Users\\privatePerson\\cards.json'`);
	assert.equal(escapedPath.includes('privatePerson'), false);
	assert.match(escapedPath, /C:\/Users\/\[REDACTED\]/);
	const digest = redactText('Authorization: Digest username="privateAuthUser", response="digestSecret"');
	assert.equal(digest.includes('privateAuthUser'), false);
	assert.equal(digest.includes('digestSecret'), false);
	const extendedKey = redactText('https://tcg.mik.moe/deck?X-API-Key=headerSecret&proxy_password=proxySecret');
	assert.equal(extendedKey.includes('headerSecret'), false);
	assert.equal(extendedKey.includes('proxySecret'), false);
	const sensitiveFirst = redactText('https://tcg.mik.moe/deck?token=privateToken&deckCode=ordinaryDeckCode');
	assert.match(sensitiveFirst, /deckCode=ordinaryDeckCode/);
	assert.equal(sensitiveFirst.includes('privateToken'), false);
});

test('runner event names are normalized and archive generation has an explicit deadline', async t => {
	const store = makeStore(temporaryDirectory(t));
	const context = store.begin({ input: 'one-deck', side: 'L' });
	store.record(context, { stage: 'import', event: 'finished' });
	const { files, events } = await readArchive(store);
	assert.equal(events.at(-1).event, 'finished');
	assert.equal(events.at(-1).status, 'finished');
	assert.match(files['summary.txt'], /import \/ finished/);
	const timeoutDirectory = temporaryDirectory(t);
	const timeoutStore = makeStore(timeoutDirectory, { exportTimeoutMs: 1 });
	await assert.rejects(timeoutStore.exportArchive(), /タイムアウト/);
	const timeouts = fs.readFileSync(path.join(timeoutDirectory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
	assert.ok(timeouts.some(event => event.stage === 'process.timeout' && event.status === 'failed'));
	assert.ok(timeouts.some(event => event.stage === 'process.kill' && event.signal === 'SIGKILL'));
});

test('late subprocess exit evidence cannot replace a failed import result in the summary', async t => {
	const store = makeStore(temporaryDirectory(t));
	const context = store.begin({ input: 'timed-out-deck', side: 'L' });
	store.record(context, { stage: 'process.timeout', event: 'failed', message: '整次导入超时' });
	store.record(context, { stage: 'import', event: 'failed', message: '整次导入超时' });
	store.record(context, { stage: 'process.exit', event: 'finished', signal: 'SIGKILL', timedOut: true });
	const { files, events } = await readArchive(store);
	assert.equal(events.at(-1).stage, 'process.exit');
	assert.match(files['summary.txt'], new RegExp(context.id + ': import / failed'));
	assert.equal(files['summary.txt'].includes(context.id + ': process.exit / finished'), false);
});

test('language, operation and script identities survive restart and aggressive truncation', async t => {
	const directory = temporaryDirectory(t);
	const store = makeStore(directory, { maxBytes: 2400 });
	const contexts = [];
	for (const language of ['jp', 'cht', 'en']) {
		const context = store.begin({ input: 'deck-' + language, side: 'R', language,
			operation: 'import', script: `extract_deck_cards_${language}.py`, source: 'timeline' });
		contexts.push(context);
	}
	const initial = await readArchive(store);
	assert.deepEqual(initial.events.map(event => event.language), ['jp', 'cht', 'en']);
	assert.ok(initial.events.every(event => event.source === 'timeline'));
	for (const context of contexts) {
		store.record(context, { stage: 'card.fetch', event: 'failed', traceback: 'x'.repeat(40000),
			message: '障害'.repeat(10000) });
	}
	const restarted = makeStore(directory, { maxBytes: 2400 });
	const { files, events } = await readArchive(restarted);
	const failure = events.at(-1);
	assert.equal(failure.language, 'en');
	assert.equal(failure.operation, 'import');
	assert.equal(failure.script, 'extract_deck_cards_en.py');
	assert.equal(failure.truncated, true);
	assert.match(files['summary.txt'], /Python 执行诊断/);
	assert.equal(files['summary.txt'].includes('简体中文导入诊断'), false);
	assert.equal(JSON.parse(files['environment.json']).language, undefined);
});

test('an environment probe exception is included in its first immutable export', async t => {
	const directory = temporaryDirectory(t);
	const store = makeStore(directory, { spawnProcess(command, args, options) {
		if (args[0] === '-c') {
			return spawn(command, ['-c', 'raise RuntimeError("日本語错误 probe failure token=privateProbeToken")'], options);
		}
		return spawn(command, args, options);
	} });
	const first = store.exportArchive();
	assert.equal(store.exportArchive(), first);
	store.begin({ input: 'later-user-import', language: 'jp' });
	const archive = await first;
	assert.equal(archive.empty, false);
	const read = spawnSync(PYTHON, ['-c', ZIP_READER], { input: archive.data, encoding: 'utf8' });
	assert.equal(read.status, 0, read.stderr);
	const files = JSON.parse(read.stdout);
	const events = files['events.jsonl'].trim().split('\n').map(JSON.parse);
	assert.ok(events.some(event => event.operation === 'python.version' && event.language === 'runtime' && event.script === '-c'));
	assert.ok(events.some(event => event.message && event.message.includes('RuntimeError')));
	assert.ok(events.some(event => event.message && event.message.includes('日本語错误')));
	assert.equal(files['events.jsonl'].includes('privateProbeToken'), false);
	assert.equal(files['events.jsonl'].includes('later-user-import'), false);
	assert.equal(JSON.parse(files['environment.json']).pythonVersion, 'unavailable');
});

test('a failed Python archive generator is captured and the next successful ZIP includes the evidence', async t => {
	const directory = temporaryDirectory(t);
	let failArchive = true;
	const store = makeStore(directory, { spawnProcess(command, args, options) {
		if (failArchive && path.basename(args[0]) === 'export_diagnostics.py') {
			return spawn(command, ['-c', 'raise RuntimeError("archive failure password=privateArchivePassword")'], options);
		}
		return spawn(command, args, options);
	} });
	await assert.rejects(store.exportArchive(), error => {
		assert.equal(error.message.includes('privateArchivePassword'), false);
		assert.equal(error.message.includes('archive failure'), false);
		return true;
	});
	failArchive = false;
	const recovered = await readArchive(store);
	assert.ok(recovered.events.some(event => event.operation === 'diagnostics.export' && event.script === 'export_diagnostics.py'));
	assert.ok(recovered.events.some(event => event.stage === 'process.stderr' && event.message.includes('RuntimeError')));
	assert.ok(recovered.events.some(event => event.stage === 'diagnostics.export' && event.status === 'failed'));
	assert.equal(recovered.files['events.jsonl'].includes('privateArchivePassword'), false);
	assert.equal(recovered.events.some(event => event.operation === 'python.version'), false);
	assert.deepEqual((await readArchive(store)).events, recovered.events);
});

test('successful diagnostic tooling never turns an empty export into retained activity', async t => {
	const directory = temporaryDirectory(t);
	const store = makeStore(directory);
	assert.equal((await store.exportArchive()).empty, true);
	assert.equal((await store.exportArchive()).empty, true);
	assert.equal(fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8'), '');
	assert.equal((await makeStore(directory).exportArchive()).empty, true);
	const context = store.begin({ language: 'runtime', operation: 'python.script', script: 'card_utils_chs.py' });
	store.record(context, { stage: 'python.script', event: 'finished' });
	assert.equal((await store.exportArchive()).empty, false);
});

test('stdin write errors preserve their cause and kill the internal Python before a recovery export', async t => {
	const directory = temporaryDirectory(t);
	let breakInput = true;
	const store = makeStore(directory, { spawnProcess(command, args, options) {
		const child = spawn(command, args, options);
		if (breakInput && path.basename(args[0]) === 'export_diagnostics.py') {
			process.nextTick(() => child.stdin.emit('error', Object.assign(
				new Error('input pipe failed token=privatePipeToken'), { code: 'EPIPE' })));
		}
		return child;
	} });
	await assert.rejects(store.exportArchive(), /入力/);
	breakInput = false;
	const { files, events } = await readArchive(store);
	assert.ok(events.some(event => event.stage === 'process.stdin' && (event.code || event.exception?.code) === 'EPIPE'));
	assert.ok(events.some(event => event.stage === 'process.kill' && event.reason === 'stdin_error'));
	assert.equal(files['events.jsonl'].includes('privatePipeToken'), false);
});
