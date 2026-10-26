/**
 * [INPUT]: NodeCG の通知・logger、Node.js UUID とタイマー、優先度の期限と完了処理の注入関数に依存する。
 * [OUTPUT]: 開始・封鎖・画面別応答・取消を一つの寿命へまとめる createAnimationBatchCoordinator を提供する。
 * [POS]: extension の演出待機境界。盤面と操作の所有権は index に残し、古い通知と期限が次の批次を進めないようにする。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';
const { randomUUID } = require('node:crypto');

function createAnimationBatchCoordinator({ nodecg, getTimeout, onComplete }) {
    let active = null;

    function cancel(reason = 'cancelled') {
        if (!active) return;
        const batch = active;
        active = null;
        if (batch.timeout !== null) clearTimeout(batch.timeout);
        nodecg.sendMessage('animationBatchCancelled', { batchId: batch.id, reason });
    }

    function finish(batchId, reason) {
        if (!active || active.id !== batchId || !active.sealed) return false;
        cancel(reason);
        onComplete();
        return true;
    }

    function begin(graphics, priority) {
        cancel();
        const id = randomUUID();
        active = { id, graphics: new Set(graphics), completed: new Set(), priority,
            sealed: false, timeout: null };
        nodecg.sendMessage('animationBatchStart', { batchId: id, graphics: [...active.graphics] });
        return id;
    }

    function seal(batchId) {
        if (!active || active.id !== batchId || active.sealed) return;
        active.sealed = true;
        active.timeout = setTimeout(() => {
            if (!active || active.id !== batchId) return;
            nodecg.log.warn(`Animation batch ${batchId} timed out; proceeding to the next batch.`);
            finish(batchId, 'timeout');
        }, getTimeout(active.priority));
        nodecg.sendMessage('animationBatchEnd', { batchId });
    }

    function acknowledge(data) {
        if (!active || !active.sealed || !data || data.batchId !== active.id ||
            !active.graphics.has(data.graphic) || active.completed.has(data.graphic)) return false;
        active.completed.add(data.graphic);
        if (active.completed.size === active.graphics.size) finish(data.batchId, 'ack');
        return true;
    }

    return { begin, seal, acknowledge, cancel };
}
module.exports = { createAnimationBatchCoordinator };
