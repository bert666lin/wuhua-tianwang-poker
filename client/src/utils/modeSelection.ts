export type DeckCount = 2 | 3;
export type PlayerCount = 3 | 4 | 5 | 6;

/**
 * 人数-副数 -> 服务端模式 id。
 *
 * 必须是 Partial：5人2副 / 6人2副【不存在】（两副牌只有 108 张，5、6 人分不开），
 * 用完整 Record 会要求把这两个不存在的组合也填上，反而逼着人瞎填一个模式，
 * 那就等于静默降级了。缺失的键由 getModeIdForSelection 返回 null。
 */
const MODE_IDS: Partial<Record<`${PlayerCount}-${DeckCount}`, string>> = {
  '3-2': 'threePlayerTwoDecks',
  '3-3': 'threePlayerThreeDecks',
  '4-2': 'fourPlayerTwoDecks',
  '4-3': 'fourPlayerThreeDecks',
  '5-3': 'fivePlayerThreeDecks',
  '6-3': 'sixPlayerThreeDecks',
};

/** 人数 × 副数 -> 服务端模式。不支持的组合返回 null，绝不静默降级。 */
export function getModeIdForSelection(
  playerCount: number,
  deckCount: number,
): string | null {
  const key = `${playerCount}-${deckCount}` as keyof typeof MODE_IDS;
  return MODE_IDS[key] ?? null;
}

/**
 * 战绩里的中文模式名（如「4人 3副」）反查模式 id。
 * 「再来一局」要按原局模式重开，所以需要这个反向映射。
 * 解析不出来时返回 null，由调用方决定回落策略。
 */
export function getModeIdForLabel(label: string): string | null {
  const m = /(\d)\s*人\s*(\d)\s*副/.exec(label);
  if (!m) return null;
  return getModeIdForSelection(Number(m[1]), Number(m[2]));
}

/** 服务端模式 id -> 「N人 M副」中文标签。未知 id 返回 null。 */
export function getModeLabel(modeId: string): string | null {
  for (const [key, id] of Object.entries(MODE_IDS)) {
    if (id !== modeId) continue;
    const [players, decks] = key.split('-');
    return `${players}人 ${decks}副`;
  }
  return null;
}

/**
 * 每个模式的发牌参数。必须与服务端 `server/src/logic/config.ts` 的 GAME_MODES 一致，
 * 不能用「总牌数 % 人数」现场算 —— 5 人 3 副是 29 张/人 + 17 张底，
 * 取余算出来是 7 张底，会把界面上的数字写错。
 */
export interface ModeDeal {
  playerCount: PlayerCount;
  deckCount: DeckCount;
  totalCards: number;
  perPlayer: number;
  bottomCount: number;
  totalScore: number;
}

const MODE_DEALS: Record<string, ModeDeal> = {
  threePlayerTwoDecks:   { playerCount: 3, deckCount: 2, totalCards: 108, perPlayer: 32, bottomCount: 12, totalScore: 200 },
  threePlayerThreeDecks: { playerCount: 3, deckCount: 3, totalCards: 162, perPlayer: 48, bottomCount: 18, totalScore: 300 },
  fourPlayerTwoDecks:    { playerCount: 4, deckCount: 2, totalCards: 108, perPlayer: 24, bottomCount: 12, totalScore: 200 },
  fourPlayerThreeDecks:  { playerCount: 4, deckCount: 3, totalCards: 162, perPlayer: 36, bottomCount: 18, totalScore: 300 },
  fivePlayerThreeDecks:  { playerCount: 5, deckCount: 3, totalCards: 162, perPlayer: 29, bottomCount: 17, totalScore: 300 },
  sixPlayerThreeDecks:   { playerCount: 6, deckCount: 3, totalCards: 162, perPlayer: 24, bottomCount: 18, totalScore: 300 },
};

/** 取模式的发牌参数。未知模式返回 null。 */
export function getModeDeal(modeId: string): ModeDeal | null {
  return MODE_DEALS[modeId] ?? null;
}

/** 按人数 × 副数取发牌参数。不支持的组合返回 null。 */
export function getModeDealForSelection(playerCount: number, deckCount: number): ModeDeal | null {
  const id = getModeIdForSelection(playerCount, deckCount);
  return id ? getModeDeal(id) : null;
}
