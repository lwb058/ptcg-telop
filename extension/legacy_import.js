/**
 * Input: node:path, node:string_decoder, ./python_process, ./import_diagnostics
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: 共通 Python 起動境界、診断保存器と注入された JP/CHT/EN のカード DB・デッキ操作に依存する。
 * [OUTPUT]: createLegacyImporter が既存 CLI の stdout と終了コードを維持し、試行ごとの原因・警告・診断番号を返す。
 * [POS]: extension の従来言語アダプター。タイムラインのデッキ専用取得と画面の単カードフォールバックを同じ観測境界に接続する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

'use strict';

const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { spawnPython } = require('./python_process');
const { redactText } = require('./import_diagnostics');

const MAX_OUTPUT_BYTES = 1024 * 1024;
const SCRIPT_LANGUAGES = new Set(['jp', 'cht', 'en']);

function createLegacyImporter({ pythonDir, pythonCommand, diagnostics, getSettings,
    databasePathFor, reloadDatabase, getDatabase, getDeck, commitDeck,
    onLoading = () => {}, spawnProcess, reloadDelayMs = 200 }) {

    async function run({ side, code, allowCardFallback = true, progressOptions = { scale: 1, offset: 0 } }) {
        const requestedLanguage = getSettings().language || 'jp';
        const language = SCRIPT_LANGUAGES.has(requestedLanguage) ? requestedLanguage : 'jp';
        const context = diagnostics.begin({ input: code, side, language, operation: 'import' });
        const reasons = [];
        const write = event => { try { diagnostics.record(context, event); } catch (_) { /* 保存障害は取得を妨げない。 */ } };

        function runScript(type, attempt) {
            const script = type === 'deck' ? `extract_deck_cards_${language}.py` : `get_single_card_${language}.py`;
            const input = type === 'card' ? code.replace('/', '-') : code;
            const args = [path.join(pythonDir, script), input, '--database-path', databasePathFor(language)];
            if (type === 'deck' && !getSettings().forceRefetchDeck) args.push('--keep');
            const warnings = [];
            let lastCause = '';
            const recorder = { record(recordContext, event) {
                write(event);
                if (!event.message) return;
                const status = event.event || event.status;
                if (status === 'failed' || status === 'warning' ||
                    (['stderr', 'stdout'].includes(status) && /\b(error|failed|warning|exception)\b|\b\w*(?:Error|Exception)\s*:/i.test(event.message))) {
                    const message = redactText(String(event.message)).slice(0, 600);
                    lastCause = message;
                    if (warnings.length < 50 && !warnings.some(warning => warning.message === message && warning.cardId === event.cardId)) {
                        warnings.push({ stage: event.stage, cardId: event.cardId, message });
                    }
                }
            } };
            return new Promise((resolve, reject) => {
                let child;
                try {
                    child = spawnPython({ command: pythonCommand, args, diagnostics: recorder, context,
                        details: { script, attempt, attemptType: type, operation: 'import' }, captureStdout: true,
                        spawnProcess, options: { cwd: pythonDir, env: { ...process.env,
                            PTCG_DIAGNOSTIC_ID: context.id, PTCG_ATTEMPT_TYPE: type,
                            PTCG_LANGUAGE: language, PTCG_SCRIPT: script } } });
                } catch (error) { reject(error); return; }
                const stdoutDecoder = new StringDecoder('utf8');
                const stderrDecoder = new StringDecoder('utf8');
                let stdout = '', stderrLine = '', size = 0, settled = false;
                const finish = (error, result) => {
                    if (settled) return;
                    settled = true;
                    if (error) reject(error); else resolve(result);
                };
                child.stdout.on('data', data => {
                    if (settled) return;
                    size += data.length;
                    if (size > MAX_OUTPUT_BYTES) {
                        write({ script, attemptType: type, stage: 'process.output', event: 'failed', message: 'Python output exceeds the size limit.' });
                        child.kill('SIGKILL');
                        finish(new Error('Python output exceeds the size limit.'));
                    } else stdout += stdoutDecoder.write(data);
                });
                child.stderr.on('data', data => {
                    if (settled) return;
                    stderrLine += stderrDecoder.write(data);
                    let end;
                    while ((end = stderrLine.indexOf('\n')) !== -1) {
                        const match = stderrLine.slice(0, end).match(/--- Processing card (\d+)\/(\d+):/);
                        if (match && Number(match[2]) > 0) {
                            const percentage = Math.round(Number(match[1]) / Number(match[2]) * 100 * progressOptions.scale + progressOptions.offset);
                            onLoading({ loading: true, side, percentage, text: `${percentage}%` });
                        }
                        stderrLine = stderrLine.slice(end + 1);
                    }
                    if (stderrLine.length > 16000) stderrLine = stderrLine.slice(-16000);
                });
                child.on('error', error => finish(error));
                child.on('close', (exitCode, signal) => {
                    if (settled) return;
                    stdout += stdoutDecoder.end();
                    if (exitCode !== 0 || signal) {
                        finish(new Error(lastCause || `Python exited with code ${exitCode}${signal ? ` (${signal})` : ''}.`));
                    } else finish(null, { stdout, warnings, script });
                });
            });
        }

        function addCard(id) {
            const deck = getDeck(side);
            if (!Array.isArray(deck.cards)) deck.cards = [];
            if (!deck.cards.includes(id)) deck.cards = [...deck.cards, id];
        }

        try {
            if (!['L', 'R'].includes(side) || typeof code !== 'string' || !code.trim() || code.length > 8192) {
                throw new Error('Please enter a valid deck or card ID.');
            }
            code = code.trim();
            onLoading({ loading: true, side, percentage: 0, text: 'Fetching...' });
            const types = allowCardFallback ? ['deck', 'card'] : ['deck'];
            for (let index = 0; index < types.length; index++) {
                const type = types[index];
                let result;
                try {
                    if (type === 'card') {
                        const id = code.replace('/', '-');
                        const cached = getDatabase();
                        if (cached && cached[id] && cached[id].name) {
                            write({ stage: 'card.cache', event: 'finished', attemptType: type, cardId: id });
                            addCard(id);
                            result = { warnings: [] };
                        } else {
                            result = await runScript(type, index + 1);
                            reloadDatabase();
                            await new Promise(resolve => setTimeout(resolve, reloadDelayMs));
                            const database = getDatabase();
                            if (!database || !database[id] || !database[id].name) {
                                throw new Error(result.warnings.at(-1)?.message || `Failed to fetch card ${id}.`);
                            }
                            addCard(id);
                        }
                    } else {
                        result = await runScript(type, index + 1);
                        let cards;
                        try {
                            const output = JSON.parse(result.stdout);
                            if (!output || !Array.isArray(output.cards)) throw new Error('Python did not return a card list.');
                            cards = output.cards;
                        } catch (error) {
                            write({ script: result.script, stage: 'process.output', event: 'failed', attemptType: type,
                                message: error.message, traceback: error.stack });
                            throw error;
                        }
                        reloadDatabase();
                        commitDeck(side, code, cards);
                    }
                } catch (error) {
                    const message = redactText(error.message || String(error));
                    reasons.push({ type, message });
                    write({ script: type === 'deck' ? `extract_deck_cards_${language}.py` : `get_single_card_${language}.py`,
                        stage: 'import.attempt', event: 'failed', attempt: index + 1, attemptType: type, message, traceback: error.stack });
                    continue;
                }
                const warnings = result.warnings;
                const status = warnings.length || diagnostics.getWarning() ? 'warning' : 'success';
                write({ stage: 'import', event: status, attemptType: type });
                return { type, code, language, status, warnings, diagnosticId: context.id,
                    diagnosticsWarning: diagnostics.getWarning() };
            }
            throw new Error(reasons.map(reason => `${reason.type}: ${reason.message}`).join('\n'));
        } catch (error) {
            const message = redactText(error.message || String(error));
            write({ stage: 'import', event: 'failed', message });
            throw { error: message, message, diagnosticId: context.id, diagnosticsWarning: diagnostics.getWarning() };
        } finally {
            onLoading({ loading: false, side: null, percentage: 0, text: '' });
        }
    }
    return { run };
}

module.exports = { createLegacyImporter };
