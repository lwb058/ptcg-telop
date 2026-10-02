/**
 * Input: path, child_process, string_decoder
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: child_process と StringDecoder、および注入された診断保存器に依存する。
 * [OUTPUT]: UTF-8／無バッファで起動し、実 ChildProcess を維持しながら起動・終了・テキスト出力を記録する spawnPython を提供する。
 * [POS]: extension の共通 Python 起動境界。業務の入出力契約と診断保存を分離し、ZIP の標準出力は既定で収集しない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const PREFIX = 'PTCG_DIAG ';
const MAX_LINE_CHARS = 8000;
const HALF_LINE_CHARS = MAX_LINE_CHARS / 2;

function scriptName(args) {
    const first = String(args[0] || '[unknown]');
    return (first.startsWith('-') ? first : path.basename(first.replace(/\\/g, '/'))).slice(0, 256);
}

// ----- 一行が巨大でも先頭と末尾の原因を残し、保持量だけを制限する -----
function createLines(emit) {
    const decoder = new StringDecoder('utf8');
    let head = '', tail = '', length = 0;

    function append(text) {
        length += text.length;
        const needed = HALF_LINE_CHARS - head.length;
        if (needed > 0) {
            head += text.slice(0, needed);
            text = text.slice(needed);
        }
        if (text) tail = (tail + text).slice(-HALF_LINE_CHARS);
    }

    function flush() {
        if (!length) return;
        const omittedChars = Math.max(0, length - head.length - tail.length);
        const text = (head + (omittedChars ? ` [TRUNCATED ${omittedChars} chars] ` : '') + tail).replace(/\r$/, '');
        emit(text, omittedChars ? { truncated: true, omittedChars } : {});
        head = ''; tail = ''; length = 0;
    }

    function consume(text) {
        let start = 0, end;
        while ((end = text.indexOf('\n', start)) !== -1) {
            append(text.slice(start, end));
            flush();
            start = end + 1;
        }
        append(text.slice(start));
    }

    return {
        write(data) { consume(typeof data === 'string' ? data : decoder.write(data)); },
        end() { consume(decoder.end()); flush(); }
    };
}

function spawnPython({ command, args, options = {}, diagnostics, context, details = {},
    captureStdout = false, recordStderr = true, spawnProcess = spawn, now = Date.now }) {
    const started = now();
    const script = scriptName(args);

    // ----- 保存障害は子プロセスや既存の業務リスナーへ伝播させない -----
    function record(event) {
        try {
            if (diagnostics && typeof diagnostics.record === 'function') {
                diagnostics.record(context, { ...event, ...details, script });
            }
        } catch (_) { /* 診断は業務処理を妨げない。 */ }
    }

    function processError(error) {
        record({ stage: 'process.error', event: 'failed', errorType: error.name,
            message: error.message, code: error.code, stack: error.stack });
    }

    record({ stage: 'process.spawn', event: 'started' });
    let child;
    try {
        child = spawnProcess(command, args, { ...options, windowsHide: true,
            env: { ...process.env, ...options.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
    }
    catch (error) { processError(error); throw error; }

    function observe(stream, name) {
        if (!stream) return null;
        const lines = createLines((text, truncation) => {
            if (!text.trim()) return;
            if (name === 'stderr' && text.startsWith(PREFIX) && !truncation.truncated) {
                try {
                    const event = JSON.parse(text.slice(PREFIX.length));
                    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid diagnostic event');
                    record({ ...event, stage: typeof event.stage === 'string' ? event.stage : 'process.stderr',
                        event: typeof event.event === 'string' ? event.event : 'diagnostic', stream: name });
                    return;
                } catch (_) { /* 壊れたイベントも元の出力として保全する。 */ }
            }
            record({ stage: `process.${name}`, event: name, message: text, stream: name, ...truncation });
        });
        stream.on('data', data => {
            try { lines.write(data); } catch (_) { /* 観測障害も業務の出力を変えない。 */ }
        });
        return lines;
    }

    // ----- バイナリや独自 stderr 解析でも管道の読書障害は必ず保持する -----
    for (const name of ['stdin', 'stdout', 'stderr']) {
        if (child[name]) child[name].on('error', error => record({ stage: `process.${name}`, event: 'failed',
            stream: name, errorType: error.name, message: error.message, code: error.code, stack: error.stack }));
    }
    const stderr = recordStderr ? observe(child.stderr, 'stderr') : null;
    const stdout = captureStdout ? observe(child.stdout, 'stdout') : null;
    child.on('error', processError);
    child.on('close', (exitCode, signal) => {
        for (const lines of [stderr, stdout]) {
            try { if (lines) lines.end(); } catch (_) { /* 終端の観測障害は無視する。 */ }
        }
        record({ stage: 'process.exit', event: exitCode === 0 && !signal ? 'finished' : 'failed',
            exitCode, signal, durationMs: now() - started });
    });
    return child;
}

module.exports = { spawnPython };
