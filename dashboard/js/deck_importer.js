/**
 * Input: None
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: 入力／ボタン DOM、importDeckOrCard、deckLoadingStatus、設定／翻訳 Replicant と呼出側の成功コールバックに依存する。
 * [OUTPUT]: setupDeckImporter が進捗と入力抑止を同期し、成功後の ID 更新と言語共通の警告・原因・診断番号の通知を提供する。
 * [POS]: dashboard/js の共通取り込みアダプター。取得と状態の確定は extension に委ね、失敗時に成功済みデッキ ID を変更しない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

/**
 * Shared module for handling deck/card imports.
 * It sets up event listeners for an input field and a button,
 * sends an import message to the backend, and handles loading status UI updates.
 */
function setupDeckImporter({ side, inputId, buttonId, onDeckIdChange }) {
    const upperCaseSide = side.toUpperCase();
    const inputEl = document.getElementById(inputId);
    const buttonEl = document.getElementById(buttonId);

    if (!inputEl || !buttonEl) {
        console.error(`Deck importer setup failed for side ${side}: Elements not found.`);
        return;
    }

    const deckLoadingStatus = nodecg.Replicant('deckLoadingStatus');
    const importSettings = nodecg.Replicant('ptcg-settings');
    const importStrings = nodecg.Replicant('i18nStrings');
    let pending = false;

    function text(key, fallback) {
        const lang = (importSettings.value && importSettings.value.language) || 'jp';
        const entry = importStrings.value && importStrings.value[key];
        return entry ? (entry[lang] || entry.jp || fallback) : fallback;
    }

    // ---- 読みやすい診断結果 ----
    function stageText(stage) {
        const categories = [
            ['image', /image/], ['database', /database|^db/], ['deck', /deck/], ['packs', /packs/],
            ['card', /card/], ['input', /input/], ['commit', /commit|state/],
            ['process', /process|import/]
        ];
        const match = categories.find(([, pattern]) => pattern.test(stage || ''));
        return match ? text(`import_stage_${match[0]}`, '') : '';
    }

    function diagnosticLines(result) {
        const lines = [];
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];
        warnings.forEach(warning => {
            if (typeof warning === 'string') {
                lines.push(warning);
            } else if (warning && warning.message) {
                const cardId = warning.cardId || warning.card_id;
                const stage = stageText(warning.stage);
                const message = stage ? `${stage}: ${warning.message}` : warning.message;
                lines.push(cardId ? `${message} (${cardId})` : message);
            }
        });
        const missingImages = Array.isArray(result.missingImages) ? result.missingImages : [];
        const cardIds = missingImages.map(item => typeof item === 'string' ? item : (item && (item.cardId || item.card_id || item.id)))
            .filter(Boolean);
        if (cardIds.length) {
            lines.push(`${text('import_missing_images', 'Cards with missing images')}: ${[...new Set(cardIds)].join(', ')}`);
        }
        if (result.diagnosticsWarning) {
            lines.push(text('import_diagnostics_unavailable', 'Some diagnostic records could not be saved.'));
        }
        return [...new Set(lines)];
    }

    function diagnosticReference(result) {
        const lines = [];
        if (result && result.diagnosticId) {
            lines.push(`${text('import_diagnostic_id', 'Diagnostic ID')}: ${result.diagnosticId}`);
        }
        lines.push(text('import_diagnostics_help', 'Use Export Diagnostics in Settings and send the ZIP to the developer.'));
        return lines;
    }

    // Function to handle the import logic
    function handleImport() {
        if (pending || buttonEl.disabled) return;
        const code = inputEl.value.trim();
        if (!code) {
            alert(text('import_input_required', 'Please enter a Deck ID or Card ID.'));
            return;
        }

        const isChsImport = importSettings.value && importSettings.value.language === 'chs';
        pending = true;
        updateLoadingStatus();

        nodecg.sendMessage('importDeckOrCard', { side: upperCaseSide, code: code })
            .then(result => {
                // 成功通知後に更新し、単カード追加ではデッキ ID を置き換えない。
                if (onDeckIdChange) {
                    onDeckIdChange(code, result);
                }
                // Clear input only on success if it's not a player panel
                if (!onDeckIdChange) {
                    inputEl.value = '';
                }
                if (result && typeof result === 'object') {
                    const lines = diagnosticLines(result);
                    if (lines.length) {
                        alert([text('import_with_warnings', 'Import completed with warnings'), ...lines,
                            '', ...diagnosticReference(result)].join('\n'));
                    }
                }
            })
            .catch(err => {
                const reason = typeof err === 'string' ? err : ((err && (err.error || err.message)) || text('import_unknown_error', 'Unknown error'));
                if (isChsImport || (err && err.diagnosticId)) {
                    const lines = [text('import_failed', 'Failed to import'), reason];
                    if (err && err.diagnosticsWarning) lines.push(text('import_diagnostics_unavailable', 'Some diagnostic records could not be saved.'));
                    alert([...lines, '', ...diagnosticReference(err)].join('\n'));
                } else {
                    alert(`Failed to import: ${reason}`);
                }
            })
            .finally(() => {
                pending = false;
                updateLoadingStatus();
            });
    }

    // Attach event listeners
    buttonEl.addEventListener('click', handleImport);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleImport();
        }
    });

    // Listen for loading status changes
    function updateLoadingStatus(newStatus = deckLoadingStatus.value || {}) {
        const isLoading = !!newStatus.loading;
        const statusSide = newStatus.side; // The side that is currently loading

        // In deck_viewer, we might disable both. In player_panel, only one side exists.
        const isThisPanelLoading = isLoading && statusSide === upperCaseSide;
        const isAnotherPanelLoading = isLoading && statusSide !== upperCaseSide;

        buttonEl.disabled = isLoading || pending;
        inputEl.disabled = isLoading || pending;

        if (isThisPanelLoading) {
            const percentage = newStatus.percentage || 0;
            buttonEl.textContent = `${percentage.toFixed(0)}%`;
        } else if (isAnotherPanelLoading || pending) {
            buttonEl.textContent = 'Loading...';
        } else {
            buttonEl.textContent = 'Import';
        }
    }
    deckLoadingStatus.on('change', updateLoadingStatus);
    updateLoadingStatus();
}
