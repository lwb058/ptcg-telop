/**
 * Input: None
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: Settings の診断ボタン・結果 DOM、呼出側の翻訳関数、NodeCG の exportImportDiagnostics と親ウィンドウから渡るバイナリ応答に依存する。
 * [OUTPUT]: setupDiagnosticExport が多言語表示と単一の ZIP ダウンロード要求を接続し、updateLabels を返す。
 * [POS]: dashboard/js の Settings 専用アダプター。診断の保存・匿名化・ZIP 作成は extension に委ね、応答を公開 URL にせず直接ダウンロードする。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

function setupDiagnosticExport({ getI18nText }) {
    const button = document.getElementById('export-import-diagnostics-btn');
    const status = document.getElementById('import-diagnostics-status');
    let busy = false;
    let statusKey = '';

    function updateLabels() {
        button.textContent = getI18nText(busy ? 'diagnostics_export_generating' : 'diagnostics_export_button');
        button.disabled = busy;
        button.style.opacity = busy ? '0.65' : '1';
        button.setAttribute('aria-busy', String(busy));
        status.hidden = !statusKey;
        status.textContent = statusKey ? getI18nText(statusKey) : '';
    }

    // ---- Socket.IO バイナリ応答 ----
    function toBytes(data) {
        // NodeCG の親ウィンドウ由来でも判定できるように、realm 固有の instanceof を使わない。
        if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data);
        if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (data && data.type === 'Buffer' && Array.isArray(data.data)) return Uint8Array.from(data.data);
        throw new Error('Invalid diagnostic archive response');
    }

    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        statusKey = '';
        updateLabels();
        let downloadUrl;
        let link;
        try {
            const result = await nodecg.sendMessage('exportImportDiagnostics');
            const bytes = toBytes(result && result.data);
            if (!bytes.byteLength) throw new Error('Empty diagnostic archive response');
            downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
            link = document.createElement('a');
            link.href = downloadUrl;
            link.download = (result.filename || 'ptcg-import-diagnostics.zip').replace(/[\\/]/g, '_');
            document.body.appendChild(link);
            link.click();
            statusKey = result.empty ? 'diagnostics_export_empty' : 'diagnostics_export_success';
        } catch (error) {
            statusKey = 'diagnostics_export_failed';
        } finally {
            if (link) link.remove();
            // ダウンロードの開始前に Blob を破棄しない。
            if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
            busy = false;
            updateLabels();
        }
    });

    updateLabels();
    return { updateLabels };
}
