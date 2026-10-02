/**
 * Input: None
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * [INPUT]: 攻撃者のスロット ID、draft スロット群、カード DB と両デッキのカード ID に依存する。
 * [OUTPUT]: MEMORY_SPIRAL_ABILITY_NAMES と getAttackGroups を公開し、本体・道具・ベンチ・進化前のワザを表示順の出所グループとして返す。
 * [POS]: Master Panel のワザ取得境界。進化探索・特性判定・重複排除を集約し、DOM・対戦状態・実際の攻撃者を変更しない。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */

// ---- 特性名は表示言語と独立して照合し、未入力の名前は除外する ----
const MEMORY_SPIRAL_ABILITY_NAMES = {
    jp: 'きおくのらせん',
    en: 'Memory Helix',
    chs: '记忆螺旋',
    cht: '記憶螺旋'
};

function getAttackGroups({ attackerSlotId, slots, db, deckCardIds = [] }) {
    const attacker = slots.find(slot => slot.name === `draft_${attackerSlotId}`);
    const attackerCard = db?.[attacker?.value?.cardId];
    if (!attackerCard) return [];

    // ---- 既存の優先順：本体 → 進化前 → 道具で同名ワザを一度だけ採用する ----
    const seenAttackNames = new Set();
    const uniqueAttacks = attacks => (attacks || []).filter(attack => {
        if (!attack.name || seenAttackNames.has(attack.name)) return false;
        seenAttackNames.add(attack.name);
        return true;
    });
    const pokemonGroups = new Map();
    const addPokemonAttacks = card => {
        const attacks = uniqueAttacks(card.pokemon?.attacks);
        if (!attacks.length) return;
        if (!pokemonGroups.has(card.name)) {
            pokemonGroups.set(card.name, {
                type: card.name === attackerCard.name ? 'own' : 'preEvolution',
                name: card.name,
                attacks: []
            });
        }
        pokemonGroups.get(card.name).attacks.push(...attacks);
    };
    addPokemonAttacks(attackerCard);

    // ---- 進化前は従来どおり特性で制限せず、両デッキ内の全同名版と祖先を探索する ----
    const deckIds = [...new Set(deckCardIds)];
    const namesToProcess = new Set(attackerCard.pokemon?.evolvesFrom || []);
    const processedNames = new Set();
    while (namesToProcess.size) {
        const name = namesToProcess.values().next().value;
        namesToProcess.delete(name);
        if (processedNames.has(name)) continue;
        processedNames.add(name);
        deckIds.forEach(cardId => {
            const card = db[cardId];
            if (!card || card.name !== name) return;
            addPokemonAttacks(card);
            (card.pokemon?.evolvesFrom || []).forEach(parentName => {
                if (!processedNames.has(parentName)) namesToProcess.add(parentName);
            });
        });
    }
    const toolGroup = {
        type: 'tm',
        attacks: uniqueAttacks((attacker.value.attachedToolIds || [])
            .flatMap(cardId => db[cardId]?.trainer?.attacks || []))
    };

    // ---- ベンチは現在のカード面だけ。同名でも出所ごとの打点・説明を保持する ----
    const benchGroups = [];
    const battleSlot = /^slot([LR])0$/.exec(attackerSlotId);
    const abilityNames = Object.values(MEMORY_SPIRAL_ABILITY_NAMES).map(name => name.trim()).filter(Boolean);
    const canBorrowBench = (attackerCard.pokemon?.abilities || [])
        .some(ability => abilityNames.includes(ability.name?.trim()));
    if (battleSlot && canBorrowBench) {
        slots.forEach(slot => {
            const benchSlot = /^draft_slot([LR])([1-8])$/.exec(slot.name);
            if (!benchSlot || benchSlot[1] !== battleSlot[1]) return;
            const card = db[slot.value?.cardId];
            const attacks = (card?.pokemon?.attacks || []).filter(attack => attack.name);
            if (!attacks.length) return;
            benchGroups.push({ type: 'bench', slotId: slot.name.slice('draft_'.length), name: card.name, attacks });
        });
        benchGroups.sort((left, right) => left.slotId.localeCompare(right.slotId));
    }

    // ---- 表示順は重複排除の優先順と分離する ----
    const ownGroup = pokemonGroups.get(attackerCard.name);
    const preEvolutionGroups = [...pokemonGroups.values()].filter(group => group.type === 'preEvolution');
    return [ownGroup, toolGroup, ...benchGroups, ...preEvolutionGroups]
        .filter(group => group?.attacks.length);
}
