/**
 * [INPUT]: NodeCG の animationBatchStart / End / Cancelled 通知と各画面の演出 Promise に依存する。
 * [OUTPUT]: window.AnimationBatch.create が画面ごとの収集器を返し、有効な批次の全演出終了後に { batchId, graphic } を通知する。
 * [POS]: main/extra が共有する ACK 境界。各批次に独立した集合を持ち、初期描画・履歴更新・取消済みの演出を現行批次へ混入させない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
(function () {
    'use strict';

    function create({ nodecg, graphic }) {
        let current = null;
        const hasId = message => message && typeof message.batchId === 'string' && message.batchId.length > 0;

        nodecg.listenFor('animationBatchStart', message => {
            if (!hasId(message) || !Array.isArray(message.graphics)) return;
            if (current && current.batchId === message.batchId) return;
            current = message.graphics.includes(graphic)
                ? { batchId: message.batchId, promises: [], sealed: false }
                : null;
        });

        nodecg.listenFor('animationBatchEnd', message => {
            const batch = current;
            if (!hasId(message) || !batch || batch.batchId !== message.batchId || batch.sealed) return;
            batch.sealed = true;
            Promise.allSettled(batch.promises).then(() => {
                if (current !== batch) return;
                Promise.resolve(nodecg.sendMessage('animationBatchComplete', { batchId: batch.batchId, graphic })).catch(() => {});
            });
        });

        nodecg.listenFor('animationBatchCancelled', message => {
            if (hasId(message) && current && current.batchId === message.batchId) current = null;
        });

        return {
            add(promise, batchId) {
                if (!current || current.sealed || !promise || typeof promise.then !== 'function') return;
                if (arguments.length > 1 && batchId !== current.batchId) return;
                const observed = Promise.resolve(promise);
                // End 通知を待つ間の拒否もブラウザーの未処理例外にしない。
                observed.catch(() => {});
                current.promises.push(observed);
            }
        };
    }

    window.AnimationBatch = { create };
})();
