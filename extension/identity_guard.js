/**
 * [INPUT]: スロット名をキーとする盤面と、既存の対戦操作の配列に依存する。
 * [OUTPUT]: 現在盤面と操作後の盤面について、重複した非空の instanceId を検出する純粋な検証関数を提供する。
 * [POS]: extension の個体識別検証境界。実 Replicant を変更せず、index と timeline の書込・演出前検証を支える。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';

function assertUniqueInstanceIds(slots, mode) {
    const owners = new Map();
    for (const [slotId, value] of Object.entries(slots)) {
        if (!value || !value.instanceId) continue;
        const matches = owners.get(value.instanceId) || [];
        matches.push(slotId);
        owners.set(value.instanceId, matches);
    }
    for (const [instanceId, matches] of owners) {
        if (matches.length < 2) continue;
        const error = new Error(`Duplicate instance ID '${instanceId}' in ${mode}: ${matches.join(', ')}`);
        error.code = 'DUPLICATE_INSTANCE_ID';
        error.instanceId = instanceId;
        error.slots = matches;
        throw error;
    }
}

function assertOperationsPreserveUniqueIds(slots, operations, mode, resolveTargets = mode === 'live') {
    const board = Object.fromEntries(Object.entries(slots).map(([slotId, value]) => [slotId, {
        cardId: value && value.cardId,
        instanceId: value && value.instanceId
    }]));
    assertUniqueInstanceIds(board, mode);

    // ---- 入場・退場・移動だけをコピーに反映し、実状態と履歴は変更しない ----
    for (const op of operations) {
        const payload = op.payload || {};
        if (op.type === 'SET_POKEMON') {
            board[payload.target] = { cardId: payload.cardId, instanceId: payload.instanceId };
        } else if (op.type === 'REMOVE_POKEMON') {
            const resolved = resolveTargets && payload.instanceId
                ? Object.keys(board).find(slotId => board[slotId].instanceId === payload.instanceId)
                : payload.target;
            if (resolved && board[resolved] && (!payload.instanceId || board[resolved].instanceId === payload.instanceId)) {
                board[resolved] = {};
            }
        } else if (op.type === 'REPLACE_POKEMON') {
            const resolved = resolveTargets && payload.instanceId
                ? Object.keys(board).find(slotId => board[slotId].instanceId === payload.instanceId)
                : payload.target;
            if (resolved && board[resolved]) board[resolved].cardId = payload.cardId;
        } else if (op.type === 'APPLY_SWITCH' || op.type === 'SWITCH_POKEMON') {
            let { mapping, side } = payload;
            if (!mapping && payload.source && payload.target) {
                side = payload.source.charAt(4);
                const source = payload.source.substring(5);
                const target = payload.target.substring(5);
                mapping = { [source]: target, [target]: source };
            }
            if (mapping) {
                const previous = { ...board };
                for (const [target, source] of Object.entries(mapping)) {
                    board[`slot${side}${target}`] = { ...previous[`slot${side}${source}`] };
                }
            }
        }
        assertUniqueInstanceIds(board, mode);
    }
}

module.exports = { assertUniqueInstanceIds, assertOperationsPreserveUniqueIds };
