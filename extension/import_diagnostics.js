/**
 * Input: fs, path, os, crypto, ./python_process
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: NodeCG の logger と版情報、Node.js のファイル・暗号 API、python_process の共通実行境界と export_diagnostics.py の標準入力 ZIP 契約に依存する。
 * [OUTPUT]: createImportDiagnostics と redactText を提供し、全言語の Python 証拠を識別・匿名化・容量制限付きで保存して診断 ZIP を生成する。
 * [POS]: extension の非公開診断ストア。業務取得と内部 Python ツールの障害を収め、正常な診断生成は保存せず不変スナップショットを配布する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { spawnPython } = require('./python_process');

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STRING_LENGTH = 12000;
const MAX_EVENT_BYTES = 32 * 1024;
const SENSITIVE_KEY = /^(?:password|passwd|pwd|secret|clientsecret|apisecret|secretkey|token|accesstoken|refreshtoken|authtoken|securitytoken|apikey|auth|authentication|authorization|authheader|proxyauth|proxyauthorization|proxycredentials|credentials|cookie|setcookie|username|sessionid|signature|sig|key)$/i;
const TEXT_SECRETS = /((?:["']?)(?:password|passwd|pwd|secret|(?:client|api)[_-]?secret|secret[_-]?key|(?:access[_-]?|refresh[_-]?|auth[_-]?|security[_-]?)?token|api[_-]?key|auth|authentication|authorization|auth[_-]?header|proxy[_-]?(?:auth|authorization|credentials)|cookie|session[_-]?id)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]&#?]+)/gi;

function isSensitiveKey(key) {
	const normalized = String(key).replace(/[^a-z0-9]/gi, '');
	return SENSITIVE_KEY.test(normalized) || /(?:password|passwd|token|secret|credentials|authorization|apikey)$/i.test(normalized);
}

function redactUrl(raw) {
	try {
		const url = new URL(raw);
		if (url.username || url.password) {
			url.username = 'REDACTED';
			url.password = '';
		}
		for (const key of [...url.searchParams.keys()]) {
			if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
		}
		if (url.hash.includes('=')) {
			const fragment = new URLSearchParams(url.hash.slice(1));
			for (const key of [...fragment.keys()]) {
				if (isSensitiveKey(key)) fragment.set(key, REDACTED);
			}
			url.hash = fragment.toString();
		}
		return url.toString();
	} catch (_) {
		return raw.replace(/\/\/[^/@\s]+@/g, '//REDACTED@');
	}
}

function redactText(value) {
	return String(value)
		.replace(/\b(?:https?|socks(?:4a?|5h?)?):\/\/[^\s<>"']+/gi, redactUrl)
		.replace(/\b(?:Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi, 'Authorization ' + REDACTED)
		.replace(/\b(?:proxy-)?authorization\s*:\s*[^\r\n]+/gi, 'Authorization: ' + REDACTED)
		.replace(/\b(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi, 'Cookie: ' + REDACTED)
		.replace(TEXT_SECRETS, (_, prefix) => prefix + REDACTED)
		.replace(/([a-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, (_, prefix) => prefix.replace(/[\\/]+/g, '/') + REDACTED)
		.replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1' + REDACTED)
		.replace(/\\/g, '/');
}

function sanitize(value, state = { truncated: false, seen: new WeakSet() }, depth = 0) {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
	if (typeof value === 'string' || typeof value === 'bigint') {
		const text = redactText(value);
		if (text.length <= MAX_STRING_LENGTH) return text;
		state.truncated = true;
		return text.slice(0, MAX_STRING_LENGTH) + TRUNCATED;
	}
	if (typeof value !== 'object') return undefined;
	if (depth >= 8 || state.seen.has(value)) {
		state.truncated = true;
		return TRUNCATED;
	}
	state.seen.add(value);
	let result;
	if (value instanceof Error) {
		result = sanitize({ name: value.name, message: value.message, stack: value.stack, code: value.code, cause: value.cause }, state, depth + 1);
	} else if (Array.isArray(value)) {
		if (value.length > 200) state.truncated = true;
		result = value.slice(0, 200).map(item => sanitize(item, state, depth + 1));
	} else {
		result = {};
		const entries = Object.entries(value);
		if (entries.length > 100) state.truncated = true;
		for (const [key, item] of entries.slice(0, 100)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
			const safeKey = redactText(key).slice(0, 100);
			if (isSensitiveKey(key)) result[safeKey] = REDACTED;
			else if (/^(?:responseBody|rawResponse|body|html|environment|env|config|database)$/i.test(key)) {
				result[safeKey] = { omitted: true, length: typeof item === 'string' ? item.length : undefined };
			} else result[safeKey] = sanitize(item, state, depth + 1);
		}
	}
	state.seen.delete(value);
	return result;
}

function runPython({ command, args, input, timeoutMs, maxOutputBytes, diagnostics, context, captureStdout, spawnProcess, now }) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnPython({ command, args, options: { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
				...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PTCG_DIAGNOSTIC_ID: context.id,
				PTCG_ATTEMPT_TYPE: context.operation
			} },
				diagnostics, context, captureStdout, spawnProcess, now });
		} catch (_) {
			reject(new Error('診断パッケージの生成に必要な Python を起動できません。'));
			return;
		}
		const chunks = [];
		let size = 0;
		let settled = false;
		function finish(error, data) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(data);
		}
		function terminate(reason) {
			diagnostics.record(context, { stage: 'process.kill', event: 'requested', reason, signal: 'SIGKILL' });
			try { child.kill('SIGKILL'); }
			catch (error) { diagnostics.record(context, { stage: 'process.kill', event: 'failed', exception: error }); }
		}
		const timer = setTimeout(() => {
			diagnostics.record(context, { stage: 'process.timeout', event: 'failed', timeoutMs,
				message: 'Python ツールの実行期限を超過しました。' });
			terminate('timeout');
			finish(new Error('診断パッケージの生成がタイムアウトしました。再試行してください。'));
		}, timeoutMs);
		child.on('error', () => finish(new Error('診断パッケージの生成に必要な Python を起動できません。')));
		child.stdout.on('data', chunk => {
			if (settled) return;
			size += chunk.length;
			if (size > maxOutputBytes) {
				diagnostics.record(context, { stage: 'process.output', event: 'failed', outputBytes: size, maxOutputBytes,
					message: 'Python ツールの出力が上限を超えました。' });
				terminate('output_limit');
				finish(new Error('診断パッケージの出力が上限を超えました。'));
			} else chunks.push(chunk);
		});
		child.stdout.on('error', error => {
			diagnostics.record(context, { stage: 'process.stdout', event: 'failed', exception: error });
			terminate('stdout_error');
			finish(new Error('診断パッケージの出力を Python から受け取れませんでした。'));
		});
		child.on('close', (code, signal) => {
			if (code !== 0 || signal) finish(new Error(`診断パッケージを生成できませんでした (${signal || code})。`));
			else finish(null, Buffer.concat(chunks));
		});
		child.stdin.on('error', error => {
			diagnostics.record(context, { stage: 'process.stdin', event: 'failed', exception: error });
			terminate('stdin_error');
			finish(new Error('診断パッケージの入力を Python に渡せませんでした。'));
		});
		try { child.stdin.end(input); }
		catch (error) {
			diagnostics.record(context, { stage: 'process.stdin', event: 'failed', exception: error });
			terminate('stdin_error');
			finish(new Error('診断パッケージの入力を Python に渡せませんでした。'));
		}
	});
}

function createImportDiagnostics(options) {
	const { nodecg, logDir, bundleVersion = 'unknown' } = options;
	const pythonCommand = options.pythonCommand || (os.platform() === 'win32' ? 'python' : 'python3');
	const now = options.now || Date.now;
	const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
	const retentionMs = options.retentionMs || DEFAULT_RETENTION_MS;
	const eventMaxBytes = Math.min(MAX_EVENT_BYTES, Math.floor(maxBytes / 2));
	const exportTimeoutMs = options.exportTimeoutMs || 30000;
	const eventFile = path.join(logDir, 'events.jsonl');
	const stateFile = path.join(logDir, 'retention.json');
	const retention = { removedEvents: 0, truncatedEvents: 0, unreadableEvents: 0, recoveredOversizedFiles: 0 };
	let records = [];
	let warning = null;
	let pythonVersionPromise;
	let exportPromise;

	function reportFailure(error) {
		const firstFailure = warning === null;
		warning = '診断記録を保存できません。インポートは継続します。Settings から診断パッケージをエクスポートしてください。';
		if (firstFailure && nodecg && nodecg.log && typeof nodecg.log.warn === 'function') {
			try { nodecg.log.warn('[Python diagnostics] Storage unavailable: ' + redactText(error.code || error.name || 'Error')); } catch (_) { /* logger failure cannot block imports */ }
		}
	}

	function load() {
		fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
		if (fs.existsSync(stateFile)) {
			try {
				if (fs.statSync(stateFile).size > 4096) throw new Error('Invalid retention metadata');
				const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
				for (const key of Object.keys(retention)) {
					if (Number.isSafeInteger(data[key]) && data[key] >= 0) retention[key] = data[key];
				}
			} catch (_) { retention.unreadableEvents++; }
		}
		if (!fs.existsSync(eventFile)) return;
		const stat = fs.statSync(eventFile);
		let text;
		if (stat.size > maxBytes) {
			// ----- 旧版や中断で肥大したファイルでも最新の完全な行を救出する -----
			const tail = Buffer.alloc(maxBytes);
			const descriptor = fs.openSync(eventFile, 'r');
			try { fs.readSync(descriptor, tail, 0, tail.length, stat.size - maxBytes); }
			finally { fs.closeSync(descriptor); }
			text = tail.toString('utf8');
			text = text.slice(text.indexOf('\n') + 1);
			retention.recoveredOversizedFiles++;
		} else text = fs.readFileSync(eventFile, 'utf8');
		for (const line of text.split('\n')) {
			if (!line) continue;
			try {
				const event = sanitize(JSON.parse(line));
				const timestamp = Date.parse(event.time);
				if (!Number.isFinite(timestamp)) throw new Error('Invalid timestamp');
				const safeLine = JSON.stringify(event) + '\n';
				records.push({ timestamp, line: safeLine, bytes: Buffer.byteLength(safeLine) });
			} catch (_) { retention.unreadableEvents++; }
		}
	}

	function cleanup() {
		const cutoff = Number(now()) - retentionMs;
		let removed = 0;
		records = records.filter(record => {
			if (record.timestamp >= cutoff) return true;
			removed++;
			return false;
		});
		retention.removedEvents += removed;
		let total = records.reduce((sum, record) => sum + record.bytes, 0);
		while (records.length && total + Buffer.byteLength(JSON.stringify(retention)) > maxBytes) {
			total -= records.shift().bytes;
			retention.removedEvents++;
			removed++;
		}
		return removed > 0;
	}

	function persist(replace, line) {
		fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
		if (replace) fs.writeFileSync(eventFile, records.map(record => record.line).join(''), { mode: 0o600 });
		else if (line) fs.appendFileSync(eventFile, line, { mode: 0o600 });
		fs.writeFileSync(stateFile, JSON.stringify(retention), { mode: 0o600 });
	}

	try {
		load();
		cleanup();
		persist(true);
	} catch (error) { reportFailure(error); }

	function record(context, event) {
		try {
			const timestamp = Number(now());
			const state = { truncated: false, seen: new WeakSet() };
			let safe = sanitize({ ...event, status: event.status || event.event, time: new Date(timestamp).toISOString(),
				diagnosticId: context.id, language: context.language || 'chs', operation: context.operation || 'import',
				script: event.script || context.script, input: context.input, side: context.side, source: context.source }, state);
			if (state.truncated) safe.truncated = true;
			let line = JSON.stringify(safe) + '\n';
			if (Buffer.byteLength(line) > eventMaxBytes) {
				safe = {
					time: safe.time, diagnosticId: safe.diagnosticId, language: safe.language,
					operation: safe.operation, script: safe.script, source: safe.source,
					stage: safe.stage, status: safe.status, attempt: safe.attempt,
					attemptType: safe.attemptType, cardId: safe.cardId,
					message: typeof safe.message === 'string' ? safe.message.slice(0, 1000) : undefined,
					exception: typeof safe.exception === 'object' ? { name: safe.exception.name, message: String(safe.exception.message || '').slice(0, 1000) } : undefined,
					truncated: true
				};
				line = JSON.stringify(safe) + '\n';
				if (Buffer.byteLength(line) > eventMaxBytes) {
					line = JSON.stringify({ time: safe.time, diagnosticId: safe.diagnosticId, language: String(safe.language).slice(0, 40),
						operation: String(safe.operation).slice(0, 80), script: typeof safe.script === 'string' ? safe.script.slice(0, 100) : undefined,
						stage: String(safe.stage || '').slice(0, 80), status: String(safe.status || '').slice(0, 40), truncated: true }) + '\n';
				}
			}
			if (safe.truncated) retention.truncatedEvents++;
			records.push({ timestamp, line, bytes: Buffer.byteLength(line) });
			const removed = cleanup();
			persist(removed || warning !== null, line);
		} catch (error) { reportFailure(error); }
	}

	function makeContext(details = {}) {
		return { ...details, id: randomUUID(), startedAt: Number(now()),
			language: details.language || 'chs', operation: details.operation || 'import' };
	}

	function begin(details) {
		const context = makeContext(details);
		record(context, { stage: context.operation, status: 'started' });
		return context;
	}

	function runTool(operation, args, input, timeoutMs, maxOutputBytes, captureStdout = false) {
		const context = makeContext({ language: 'runtime', operation, script: path.basename(args[0]) });
		let hasEvidence = false;
		const pending = [{ stage: operation, event: 'started' }];
		const collector = { record(_context, event) {
			if (!hasEvidence && (['failed', 'warning', 'stderr'].includes(event.event) ||
				['failed', 'warning'].includes(event.status))) {
				hasEvidence = true;
				for (const preceding of pending) record(context, preceding);
				pending.length = 0;
			}
			if (hasEvidence) record(context, event);
			else if (pending.length < 10) pending.push(event);
		} };
		// ----- 正常な環境確認・ZIP 生成は保存せず、障害だけ前後の証拠を残す -----
		const result = runPython({ command: pythonCommand, args, input, timeoutMs, maxOutputBytes,
			diagnostics: collector, context, captureStdout, spawnProcess: options.spawnProcess, now }).then(data => {
			collector.record(context, { stage: operation, event: hasEvidence ? 'warning' : 'finished' });
			return data;
		}, error => {
			collector.record(context, { stage: operation, event: 'failed', message: error.message });
			throw error;
		});
		return { context, result };
	}

	function pythonVersion() {
		if (!pythonVersionPromise) {
			const tool = runTool('python.version', ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'], '', Math.min(exportTimeoutMs, 5000), 1000, true);
			pythonVersionPromise = tool.result.then(data => {
				const version = data.toString('utf8').trim();
				if (!/^\d+\.\d+\.\d+$/.test(version)) {
					record(tool.context, { stage: 'python.version', event: 'failed', message: 'Python の版情報を解釈できません。', output: version });
					return { version: 'unavailable', diagnosticId: tool.context.id };
				}
				return { version, diagnosticId: tool.context.id };
			}, () => ({ version: 'unavailable', diagnosticId: tool.context.id }));
		}
		return pythonVersionPromise;
	}

	function snapshot() {
		try {
			if (cleanup()) persist(true);
		} catch (error) { reportFailure(error); }
		const events = records.map(record => sanitize(JSON.parse(record.line)));
		return { events, retention: { ...retention }, warning, generatedAt: new Date(Number(now())).toISOString() };
	}

	function summary(data) {
		const { events } = data;
		const operations = new Map();
		const terminal = event => event.stage === (event.operation || 'import') &&
			['success', 'warning', 'failed', 'completed', 'finished', 'timeout', 'cancelled'].includes(event.status);
		for (const event of events) {
			const previous = operations.get(event.diagnosticId);
			if (!previous || terminal(event) || !terminal(previous)) operations.set(event.diagnosticId, event);
		}
		const lines = [
			'PTCG-Telop Python 実行診断 / Python 执行诊断',
			`Generated (UTC): ${data.generatedAt}`,
			`Coverage (UTC): ${events.length ? events[0].time + ' — ' + events[events.length - 1].time : 'No retained records / 没有保留的记录'}`,
			`Events: ${events.length}; Operations: ${operations.size}`,
			`Retention: ${retentionMs / 86400000} days; maximum ${maxBytes} bytes (events + retention metadata).`,
			`Removed events: ${data.retention.removedEvents}; Truncated events: ${data.retention.truncatedEvents}; Unreadable events: ${data.retention.unreadableEvents}.`,
			`Recovered oversized files: ${data.retention.recoveredOversizedFiles}; discarded prefixes cannot be counted individually.`,
			'Capacity and age cleanup may remove the start of an operation. Refer to events.jsonl for the retained sequence.',
			'导入输入和卡牌编号用于排障；密码、令牌、URL 凭据及主机用户名已脱敏。',
			'Full configuration, match recordings, card database and images are excluded.',
			''
		];
		if (data.warning) lines.push('Warning: ' + data.warning, 'Some records may not have been saved; retained in-memory records are included.', '');
		lines.push('Recent operation results (up to 200; full retained records are in events.jsonl):');
		for (const [id, event] of [...operations.entries()].slice(-200)) {
			lines.push(`${id}: ${event.stage || 'unknown'} / ${event.status || 'unknown'} @ ${event.time} [${event.language || 'unknown'}; ${event.script || event.operation || 'import'}]`);
			if (event.message) lines.push('  ' + String(event.message).slice(0, 1000));
		}
		return lines.join('\n') + '\n';
	}

	function exportArchive() {
		if (exportPromise) return exportPromise;
		const data = snapshot();
		const startsVersionProbe = !pythonVersionPromise;
		exportPromise = (async () => {
			const version = await pythonVersion();
			// ----- 呼出時点の業務スナップショットに今回の環境確認の障害だけを追加する -----
			if (startsVersionProbe) {
				const probeEvents = snapshot().events.filter(event => event.diagnosticId === version.diagnosticId);
				data.events.push(...probeEvents);
			}
			const environment = {
				bundleVersion: String(bundleVersion),
				nodecgVersion: String(options.nodecgVersion || (nodecg && nodecg.version) || (nodecg && nodecg.constructor && nodecg.constructor.version) || 'unknown'),
				nodeVersion: process.version,
				pythonVersion: version.version,
				platform: os.platform(), architecture: os.arch(),
				diagnosticLanguages: ['jp', 'chs', 'cht', 'en', 'runtime'],
				timeouts: { chs: { connectSeconds: 10, readSeconds: 30, importSeconds: 600 },
					versionProbeMs: Math.min(exportTimeoutMs, 5000), archiveMs: exportTimeoutMs },
				proxyConfigured: Object.keys(process.env).some(key => /^(?:https?|all)_proxy$/i.test(key) && Boolean(process.env[key]))
			};
			const files = {
				'summary.txt': summary(data),
				'environment.json': JSON.stringify(sanitize(environment), null, 2) + '\n',
				'events.jsonl': data.events.map(event => JSON.stringify(event)).join('\n') + (data.events.length ? '\n' : '')
			};
			const archive = await runTool('diagnostics.export', [path.join(__dirname, '..', 'python', 'export_diagnostics.py')],
				JSON.stringify(files), exportTimeoutMs, maxBytes + 1024 * 1024).result;
			const empty = !data.events.some(event => !['python.version', 'diagnostics.export'].includes(event.operation) ||
				['failed', 'warning', 'stderr'].includes(event.status));
			return { filename: 'ptcg-telop-diagnostics-' + data.generatedAt.replace(/[:.]/g, '-') + '.zip', data: archive, empty };
		})();
		exportPromise = exportPromise.finally(() => { exportPromise = null; });
		return exportPromise;
	}

	return { begin, record, getWarning: () => warning, exportArchive };
}

module.exports = { createImportDiagnostics, redactText };
