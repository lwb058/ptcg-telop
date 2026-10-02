/**
 * Input: fs, path, child_process, string_decoder, ./import_diagnostics, ./python_process
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: 共通 Python 起動器、診断保存器、設定参照・進捗通知・状態コミットの注入関数に依存する。
 * [OUTPUT]: 簡体字のデッキ／単体取得を一つの期限と診断番号で実行する createChsImporter を提供する。
 * [POS]: extension の取得境界。子プロセスの証拠と完全性を検証し、成功候補だけを index の状態所有者へ渡す。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { redactText } = require('./import_diagnostics');
const { spawnPython } = require('./python_process');

const TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 8000;
const PREFIX = 'PTCG_DIAG ';
const STAGES = {
    input: '输入处理', 'deck.fetch': '获取卡组', 'deck.parse': '解析卡组',
    'card.fetch': '获取卡牌', 'card.parse': '解析卡牌', 'card.transform': '转换卡牌资料',
    'card.cache': '检查卡牌缓存', 'card.refresh': '刷新卡牌资料',
    'packs.fetch': '获取卡包', 'packs.parse': '解析卡包', 'packs.cache': '检查卡包缓存',
    'image.check': '检查卡图', 'image.download': '下载卡图',
    'database.load': '读取数据库', 'database.save': '保存数据库',
    'database.reload': '重载数据库', 'process.spawn': '启动 Python',
    'process.output': '解析脚本结果', 'process.timeout': '等待脚本', 'process.run': '执行 Python',
    'state.commit': '提交导入结果', result: '检查导入结果'
};

function failure(stage, message, extra = {}) {
    const safe = redactText(String(message));
    return { stage, message: safe.length > 1600 ? safe.slice(0, 750) + ' [TRUNCATED] ' + safe.slice(-750) : safe, ...extra };
}

function describe(reason) {
    return `${STAGES[reason.stage] || reason.stage}：${reason.message}${reason.cardId ? ` （卡牌 ${redactText(reason.cardId)}）` : ''}`;
}

function createChsImporter({ pythonDir, databasePath, pythonCommand, diagnostics,
    getSettings, commit, onLoading = () => {}, spawnProcess = spawn,
    now = Date.now, totalTimeoutMs = TOTAL_TIMEOUT_MS }) {
    let busy = false;

    function runChild(context, attemptType, input, deadline, progressOptions) {
        return new Promise((resolve, reject) => {
            const attempt = attemptType === 'deck' ? 1 : 2;
            const started = now();
            const remaining = deadline - started;
            if (remaining <= 0) {
                reject(failure('process.timeout', '整次导入已超过等待上限。', { timedOut: true }));
                return;
            }
            const script = attemptType === 'deck' ? 'extract_deck_cards_chs.py' : 'get_single_card_chs.py';
            const args = [path.join(pythonDir, script), input, '--database-path', databasePath];
            if (!getSettings().forceRefetchDeck) args.push('--keep');
            const write = event => diagnostics.record(context, { ...event, attempt, attemptType, script });
            let child;
            try {
                child = spawnPython({ command: pythonCommand, args, diagnostics, context, spawnProcess, now,
                    recordStderr: false, details: { operation: 'import', attempt, attemptType, connectTimeoutSeconds: 10,
                        readTimeoutSeconds: 30, remainingMs: remaining },
                    options: { cwd: pythonDir, windowsHide: true, env: {
                        ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
                        PTCG_DIAGNOSTIC_ID: context.id, PTCG_ATTEMPT_TYPE: attemptType,
                        PTCG_LANGUAGE: 'chs', PTCG_SCRIPT: script
                    } } });
            } catch (error) {
                reject(failure('process.spawn', error.message, { fatal: true }));
                return;
            }
            const stdoutDecoder = new StringDecoder('utf8');
            const stderrDecoder = new StringDecoder('utf8');
            let stdout = '', stderrLine = '', omittedChars = 0, rawTail = '', stdoutBytes = 0;
            let lastStage = 'process.run', lastFailure = null, settled = false;
            let outputOverflow = false;
            const failures = [];

            function line(text, omitted = 0) {
                if (!text.trim()) return;
                if (text.startsWith(PREFIX) && !omitted) {
                    try {
                        const event = JSON.parse(text.slice(PREFIX.length));
                        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid event');
                        lastStage = typeof event.stage === 'string' ? event.stage : lastStage;
                        write({ ...event, stage: lastStage });
                        if ((event.event === 'failed' || event.status === 'failed') &&
                            lastStage !== 'result' && (event.message || event.errorType)) {
                            lastFailure = failure(lastStage, event.message || event.errorType || '未知异常', { cardId: event.cardId });
                            failures.push(lastFailure);
                            if (failures.length > 100) failures.shift();
                        }
                        if (!settled && Number.isFinite(event.current) && Number.isFinite(event.total) && event.total > 0) {
                            const percentage = Math.round(event.current / event.total * 100 * progressOptions.scale + progressOptions.offset);
                            onLoading({ loading: true, side: context.side, percentage, text: `${percentage}%` });
                        }
                        return;
                    } catch (_) {
                        write({ stage: 'process.stderr', event: 'warning', message: '无法解析脚本诊断事件。' });
                    }
                }
                // 未捕獲例外や既存 CLI の stderr も同じ番号に収める。
                rawTail = (rawTail + '\n' + text).slice(-4000);
                write({ stage: lastStage, event: 'stderr', message: text,
                    ...(omitted ? { truncated: true, omittedChars: omitted } : {}) });
                const match = text.match(/--- Processing card (\d+)\/(\d+):/);
                if (!settled && match && Number(match[2]) > 0) {
                    const percentage = Math.round(Number(match[1]) / Number(match[2]) * 100 * progressOptions.scale + progressOptions.offset);
                    onLoading({ loading: true, side: context.side, percentage, text: `${percentage}%` });
                }
            }

            function consumeStderr(text, final = false) {
                function append(piece) {
                    stderrLine += piece;
                    if (stderrLine.length > MAX_LINE_CHARS) {
                        omittedChars += stderrLine.length - MAX_LINE_CHARS;
                        stderrLine = stderrLine.slice(0, MAX_LINE_CHARS / 2) + stderrLine.slice(-MAX_LINE_CHARS / 2);
                    }
                }
                function flush() {
                    const marker = omittedChars ? ` [TRUNCATED ${omittedChars} chars] ` : '';
                    const output = omittedChars ? stderrLine.slice(0, MAX_LINE_CHARS / 2) + marker + stderrLine.slice(MAX_LINE_CHARS / 2) : stderrLine;
                    line(output.replace(/\r$/, ''), omittedChars);
                    stderrLine = ''; omittedChars = 0;
                }
                let start = 0, end;
                while ((end = text.indexOf('\n', start)) !== -1) {
                    append(text.slice(start, end)); flush(); start = end + 1;
                }
                append(text.slice(start));
                if (final && stderrLine) flush();
            }

            function finish(reason, result) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (reason) reject(reason); else resolve(result);
            }

            const timer = setTimeout(() => {
                write({ stage: 'process.timeout', event: 'failed', lastStage, durationMs: now() - started,
                    message: '整次导入超过等待上限，已终止 Python。' });
                child.kill('SIGKILL');
                finish(failure('process.timeout', `整次导入超时，最后阶段：${STAGES[lastStage] || lastStage}。`, { timedOut: true }));
            }, remaining);

            child.stdout.on('data', data => {
                if (settled) return;
                stdoutBytes += data.length;
                if (stdoutBytes > MAX_STDOUT_BYTES) {
                    outputOverflow = true;
                    child.kill('SIGKILL');
                    finish(failure('process.output', '脚本结果超过允许大小。', { fatal: true }));
                } else stdout += stdoutDecoder.write(data);
            });
            child.stderr.on('data', data => consumeStderr(stderrDecoder.write(data)));
            child.on('error', error => {
                finish(failure('process.spawn', error.message, { fatal: true }));
            });
            child.on('close', (exitCode, signal) => {
                if (!settled) {
                    stdout += stdoutDecoder.end();
                }
                consumeStderr(stderrDecoder.end(), true);
                if (settled || outputOverflow) return;
                let result;
                try { result = JSON.parse(stdout); } catch (_) {
                    const detail = lastFailure || failure(exitCode === 0 ? 'process.output' : lastStage,
                        rawTail.trim().split('\n').slice(-2).join(' ') || `脚本未返回有效 JSON（退出码 ${exitCode}）。`);
                    finish(detail);
                    return;
                }
                if (exitCode !== 0 || signal) {
                    const missing = result && Array.isArray(result.missingCards) ? result.missingCards.filter(id => typeof id === 'string') : [];
                    const cause = failures.findLast(item => missing.includes(item.cardId)) || lastFailure;
                    const detail = cause || failure(lastStage, rawTail.trim().split('\n').slice(-2).join(' ') || `Python 退出码 ${exitCode}，信号 ${signal || '无'}。`);
                    finish(missing.length ? failure(detail.stage, `${detail.message}\n缺少卡牌资料：${missing.join('、')}`, { missingCards: missing }) : detail);
                    return;
                }
                if (!result || !Array.isArray(result.cards) || !result.cards.length ||
                    result.cards.length > 1000 || result.cards.some(id => typeof id !== 'string' || !/^[\w.-]{1,256}$/.test(id)) ||
                    !Array.isArray(result.missingCards) || !Array.isArray(result.missingImages) ||
                    [...result.missingCards, ...result.missingImages].some(id => typeof id !== 'string' || !/^[\w.-]{1,256}$/.test(id)) ||
                    !Array.isArray(result.warnings) || result.warnings.some(warning => typeof warning !== 'string' &&
                        (!warning || typeof warning !== 'object' || typeof warning.message !== 'string' ||
                            (warning.stage !== undefined && typeof warning.stage !== 'string') ||
                            (warning.cardId !== undefined && typeof warning.cardId !== 'string'))) ||
                    !['success', 'warning', 'failed'].includes(result.status)) {
                    finish(failure('process.output', '脚本返回的导入结果不完整或格式错误。'));
                    return;
                }
                if (result.databaseSaved !== true) {
                    finish(failures.findLast(item => item.stage === 'database.save') || failure('database.save', '卡牌数据库未成功保存。'));
                    return;
                }
                if (result.missingCards.length || result.status === 'failed') {
                    const cause = failures.findLast(item => result.missingCards.includes(item.cardId));
                    finish(failure(cause ? cause.stage : 'card.fetch', `${cause ? cause.message + '\n' : ''}缺少卡牌资料：${result.missingCards.join('、') || '未知卡牌'}。`, { missingCards: result.missingCards }));
                    return;
                }
                finish(null, result);
            });
        });
    }

    async function run({ side, code, allowCardFallback = true, progressOptions = { scale: 1, offset: 0 } }) {
        if (busy) throw { error: '已有导入正在进行，请等待完成后重试。', message: '已有导入正在进行，请等待完成后重试。' };
        busy = true;
        const context = diagnostics.begin({ input: code, side, language: 'chs', operation: 'import' });
        const deadline = now() + totalTimeoutMs;
        const reasons = [];
        try {
            if (!['L', 'R'].includes(side) || typeof code !== 'string' || !code.trim() || code.length > 8192) {
                throw failure('input', '请输入有效卡组代码、链接或单卡 ID。', { fatal: true });
            }
            code = code.trim();
            onLoading({ loading: true, side, percentage: 0, text: '0%' });
            const types = allowCardFallback ? ['deck', 'card'] : ['deck'];
            for (const type of types) {
                let result, database, warnings;
                try {
                    result = await runChild(context, type, code, deadline, progressOptions);
                    warnings = result.warnings.map(warning => typeof warning === 'string' ? redactText(warning) : {
                        stage: warning.stage, cardId: warning.cardId, message: redactText(warning.message)
                    });
                    diagnostics.record(context, { stage: 'database.reload', event: 'started', attemptType: type });
                    try {
                        database = JSON.parse(fs.readFileSync(databasePath, 'utf8').replace(/^\uFEFF/, ''));
                        if (!database || typeof database !== 'object' || Array.isArray(database)) throw new Error('数据库必须为卡牌对象。');
                        const missing = result.cards.filter(id => !database[id] || typeof database[id].name !== 'string' || !database[id].name.trim());
                        if (missing.length) throw new Error(`数据库缺少可用资料：${[...new Set(missing)].join('、')}`);
                    } catch (error) { throw failure('database.reload', error.message, { fatal: true }); }
                    diagnostics.record(context, { stage: 'database.reload', event: 'finished', attemptType: type });
                    if (now() >= deadline) throw failure('process.timeout', '整次导入超过等待上限。', { timedOut: true });
                    if (getSettings().language !== 'chs') throw failure('state.commit', '导入期间语言已更改，请在简体中文下重新导入。', { fatal: true });
                    diagnostics.record(context, { stage: 'state.commit', event: 'started', attemptType: type });
                    commit({ side, type, code, cards: result.cards, database });
                    diagnostics.record(context, { stage: 'state.commit', event: 'finished', attemptType: type });
                } catch (reason) {
                    const detail = reason.stage ? reason : failure('state.commit', reason.message || String(reason), { fatal: true });
                    reasons.push({ type, ...detail });
                    diagnostics.record(context, { stage: detail.stage, event: 'failed', attemptType: type,
                        message: detail.message, missingCards: detail.missingCards, cardId: detail.cardId });
                    if (detail.timedOut || detail.fatal) break;
                    continue;
                }
                let diagnosticsWarning = diagnostics.getWarning();
                let status = warnings.length || result.missingImages.length || diagnosticsWarning ? 'warning' : 'success';
                diagnostics.record(context, { stage: 'import', event: status, attemptType: type,
                    missingImages: result.missingImages, durationMs: now() - context.startedAt });
                diagnosticsWarning = diagnostics.getWarning();
                if (diagnosticsWarning) status = 'warning';
                return { type, code, diagnosticId: context.id, status, warnings,
                    missingImages: result.missingImages, diagnosticsWarning };
            }
            throw { stage: 'import', message: reasons.map(reason => `${reason.type === 'deck' ? '卡组' : '单卡'}尝试：${describe(reason)}`).join('\n') };
        } catch (reason) {
            const message = reason.stage === 'import' ? reason.message : describe(reason.stage ? reason : failure('import', reason.message || String(reason)));
            diagnostics.record(context, { stage: 'import', event: 'failed', message, durationMs: now() - context.startedAt });
            throw { error: message, message, diagnosticId: context.id, diagnosticsWarning: diagnostics.getWarning() };
        } finally {
            busy = false;
            onLoading({ loading: false, side: null, percentage: 0, text: '' });
        }
    }

    return { run, isBusy: () => busy };
}

module.exports = { createChsImporter, TOTAL_TIMEOUT_MS };
