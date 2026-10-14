// 本机偏好：牌背样式等。声音/震动在 utils/sound.ts 里，不重复一套。

const CARD_BACK_KEY = 'tw_card_back';

/** 可选牌背，与商城「牌背」类目一致。 */
export const CARD_BACKS = ['默认蓝金', '墨绿丝绸', '红木龙纹', '紫金星空', '黄金 VIP', '喜庆红'] as const;
export type CardBack = (typeof CARD_BACKS)[number];

/** 读当前牌背。非法/未设置时回落默认。 */
export function getCardBack(): CardBack {
  try {
    const v = localStorage.getItem(CARD_BACK_KEY);
    if (v && (CARD_BACKS as readonly string[]).includes(v)) return v as CardBack;
  } catch { /* 读不到就用默认 */ }
  return CARD_BACKS[0];
}

/** 写牌背。 */
export function setCardBack(v: CardBack): void {
  try { localStorage.setItem(CARD_BACK_KEY, v); } catch { /* 隐私模式下写不了就算了 */ }
}

/** 牌背 -> CSS 主题键（table-v4.css 里用 [data-card-back="..."] 取色）。 */
const CARD_BACK_THEME: Record<CardBack, string> = {
  '默认蓝金': 'blue',
  '墨绿丝绸': 'green',
  '红木龙纹': 'red',
  '紫金星空': 'purple',
  '黄金 VIP': 'gold',
  '喜庆红': 'festive',
};

/** 当前牌背对应的 CSS 主题键。 */
export function cardBackTheme(v: string = getCardBack()): string {
  return CARD_BACK_THEME[v as CardBack] ?? 'blue';
}

/** 环形取下一个牌背。未知输入按默认的下一个处理。 */
export function nextCardBack(current: string): CardBack {
  const idx = (CARD_BACKS as readonly string[]).indexOf(current);
  return CARD_BACKS[(idx + 1) % CARD_BACKS.length];
}

const OWNED_KEY = 'tw_owned_v1';

/** 已拥有的牌背/道具 id 集合。默认牌背（b1）永久拥有。 */
export function getOwned(): Set<string> {
  const owned = new Set<string>(['b1']);
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    if (raw) (JSON.parse(raw) as string[]).forEach(id => owned.add(id));
  } catch { /* 坏数据当没买过 */ }
  return owned;
}

/** 记一件已拥有。 */
export function addOwned(id: string): void {
  const owned = getOwned();
  owned.add(id);
  try { localStorage.setItem(OWNED_KEY, JSON.stringify([...owned])); } catch { /* 写不了就算了 */ }
}

const FOUR_COLOR_KEY = 'tw_four_color';

/**
 * 四色牌开关。
 *
 * 四色牌 = 黑桃黑、红桃红、梅花**绿**、方块**蓝**，靠颜色而不是形状区分花色。
 * 初衷是手机横屏一手 24~48 张时单张只露 ~15px，♠/♣ 轮廓差别不到一个像素网格。
 *
 * ===== 为什么默认改成【关闭】=====
 * 原来默认开启，结果就是用户看到的「方片蓝色、梅花绿色，好难看」（实际反馈）。
 * 两点判断失误：
 *   1. 这是本地牌类玩家的产品，他们对「方块必须是红的、梅花必须是黑的」有极强
 *      的肌肉记忆，颜色变了会先觉得"这牌不对"，认花色反而更慢；
 *   2. 花色辨识的问题已经用别的手段解决了 —— 手机端把角标放大到 20ut、
 *      去掉中央大花色、手牌按花色分堆排序，不再依赖颜色去分 ♠/♣。
 * 保留开关不删：确实有人（尤其从德州/斗地主 App 过来的）习惯四色。
 * 已经手动打开过的人（localStorage 里是 '1'）不受这次改动影响。
 */
export function getFourColor(): boolean {
  try {
    return localStorage.getItem(FOUR_COLOR_KEY) === '1';
  } catch { /* 读不到按默认关 */ }
  return false;
}

/** 写四色牌开关。 */
export function setFourColor(on: boolean): void {
  try { localStorage.setItem(FOUR_COLOR_KEY, on ? '1' : '0'); } catch { /* 写不了就算了 */ }
}

/** 花色符号 -> CSS 类名后缀，供四色牌上色。 */
export function suitClass(symbol: string): string {
  switch (symbol) {
    case '\u2660': return 'spade';
    case '\u2665': return 'heart';
    case '\u2663': return 'club';
    case '\u2666': return 'diamond';
    default: return 'joker';
  }
}

const VOICE_TIP_KEY = 'tw_voice_tip_seen';

/**
 * 「按住说话」的首次使用说明是否已经看过。
 *
 * 这个按钮容易被当成微信那种"发语音消息"（按完生成一条可回听的消息），
 * 实际是**实时对讲**：按住的同时对方就在听，松手就结束，不留记录。
 * 所以第一次进牌桌要明确说一句，看过一次就不再打扰。
 */
export function hasSeenVoiceTip(): boolean {
  try { return localStorage.getItem(VOICE_TIP_KEY) === '1'; } catch { return false; }
}

/** 标记「按住说话」说明已读。 */
export function markVoiceTipSeen(): void {
  try { localStorage.setItem(VOICE_TIP_KEY, '1'); } catch { /* 写不了就算了，下次再提示一次无妨 */ }
}

const VOICE_MUTED_KEY = 'tw_voice_muted';

/**
 * 是否关掉了「听别人的语音」。
 *
 * 和音效开关分开是有原因的：原来只有一个总静音，关了语音的同时
 * 出牌音效也没了；而实际需求是"不想听人说话，但要听出牌提示音"
 * （比如在安静场合，或者同桌有人一直乱喊）。
 * 这个开关只影响别人的语音播放，不影响音效，也不影响自己说话。
 */
export function isVoiceMuted(): boolean {
  try { return localStorage.getItem(VOICE_MUTED_KEY) === '1'; } catch { return false; }
}

/** 记住「听筒」开关，下次进牌桌保持一致。 */
export function setVoiceMutedPref(muted: boolean): void {
  try { localStorage.setItem(VOICE_MUTED_KEY, muted ? '1' : '0'); } catch { /* 存不了就只在本局生效 */ }
}

/**
 * 花色符号的「文字形态」渲染值。
 *
 * ===== 为什么必须加 U+FE0E =====
 * ♠♥♦♣（U+2660…2663）在 Unicode 里属于「emoji 兼容」字符：系统可以自行决定
 * 用**文字字形**还是**彩色 emoji 字形**渲染。iOS/Safari 会优先让
 * Apple Color Emoji 接管，而**彩色 emoji 字形完全无视 CSS color** ——
 * 于是牌面花色在 iPhone 上变成彩色小图标（♦♥ 恒为红、♠♣ 恒为黑），
 * 四色牌设置失效，和安卓 Chrome 看到的完全不是一套牌面（用户反馈的现象）。
 *
 * U+FE0E 是 VARIATION SELECTOR-15（text presentation selector），
 * 明确要求「用文字字形」，此时 CSS color 重新生效。已在 WebKit 实测：
 * 不加 → 红色 emoji 原色；加了 → 跟随 CSS 颜色。
 *
 * 只用于**展示**，不能写回数据层：牌型比较、甩牌判定都按裸符号做等值比较，
 * 混入 FE0E 会让 '♠' !== '♠\uFE0E' 而全线判错。
 */
const TEXT_PRESENTATION = '\uFE0E';

/** 给花色符号加上文字形态选择符，避免被彩色 emoji 字体接管。 */
export function suitGlyph(symbol: string): string {
  if (!symbol) return symbol;
  // ★（王）和已带选择符的值不重复处理
  if (symbol.includes(TEXT_PRESENTATION)) return symbol;
  switch (symbol) {
    case '\u2660':
    case '\u2665':
    case '\u2663':
    case '\u2666':
      return symbol + TEXT_PRESENTATION;
    default:
      return symbol;
  }
}
