// ===== 商城 v4 =====
// 类目：牌背 / 道具 / 会员 / 星币
//
// 与 v3 的根本区别：
//   1. **没有充值**。原来第一个类目是 6 档人民币金币包（¥6~¥588），走一整套假支付流程。
//      本项目决定不做充值系统，金币只能靠赢牌、签到、看广告获得，所以这个类目整个删掉，
//      Purchase.tsx（551 行假支付）也一起废弃。
//   2. 商品目录、价格、余额、已购**全部来自服务端**（/api/shop），
//      购买走 /api/shop/buy 真实扣金币并入库。原来价格写在前端、扣的是 localStorage
//      里的数字，打开控制台就能改。
//   3. 新增「星币」类目：金币换星币，星币将来换实物（大米/油）。
//      实物兑换后端已实现但**总开关默认关闭**，这里读 physical.enabled 显示「即将开放」。

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CoinIcon, CrownIcon, CardBackIcon, GiftIcon, VipIcon, BoltIcon,
  CloseIcon, CheckIcon, StarIcon, LockedIcon, SpinnerIcon,
  DiamondIcon, ClubIcon, HeartIcon, SpadeIcon, FlameIcon, TicketIcon,
} from '../components/icons';
import {
  fetchShop, buyProduct, exchangeStars as exchangeStarsApi,
  exchangeRoomCards as exchangeRoomCardsApi,
  type ShopData, type ShopProductView, type PhysicalGoodView,
} from '../utils/api';
import { useAccount, setAccount } from '../hooks/useAccount';
import {
  setCardBack as setCardBackPref, getCardBack,
  CARD_BACKS as CARD_BACK_NAMES, type CardBack as CardBackName,
} from '../utils/preferences';
import { showToast } from '../utils/toast';
import '../styles/shop.css';

/** 类目。'coin'（充值）已移除，为兼容老调用点保留入参映射见 normalizeCat。 */
export type Cat = 'cardback' | 'item' | 'vip' | 'star' | 'roomcard';

interface ShopProps {
  onClose: () => void;
  /** 打开时默认选中的类目。大厅的「背包」「星币」等入口会指定。 */
  initialCat?: string;
  /** 「去赚金币」：跳活动页。不传则只给提示。 */
  onEarnCoins?: () => void;
}

const CATS: { id: Cat; label: string; icon: any }[] = [
  { id: 'cardback', label: '牌背', icon: CardBackIcon },
  { id: 'item',     label: '道具', icon: GiftIcon },
  { id: 'roomcard', label: '房卡', icon: TicketIcon },
  { id: 'vip',      label: '会员', icon: VipIcon },
  { id: 'star',     label: '星币', icon: StarIcon },
];

/** 老入口可能还传 'coin'（充值）；充值已取消，落到牌背。 */
function normalizeCat(v: string | undefined): Cat {
  return v === 'item' || v === 'vip' || v === 'star' || v === 'cardback' || v === 'roomcard'
    ? v : 'cardback';
}

/** 牌背的预览配色与花色图标，按服务端商品 id 对应。 */
const BACK_STYLE: Record<string, { color: string; suit: any }> = {
  back_blue:    { color: 'linear-gradient(135deg, #2E3D6B 0%, #1A2440 100%)', suit: SpadeIcon },
  back_green:   { color: 'linear-gradient(135deg, #1F4734 0%, #0E2A1E 100%)', suit: ClubIcon },
  back_red:     { color: 'linear-gradient(135deg, #6B2820 0%, #3D1610 100%)', suit: HeartIcon },
  back_purple:  { color: 'linear-gradient(135deg, #4A3870 0%, #1E1640 100%)', suit: DiamondIcon },
  back_festive: { color: 'linear-gradient(135deg, #A93226 0%, #6B1F18 100%)', suit: FlameIcon },
  back_gold:    { color: 'linear-gradient(135deg, #8B6A3F 0%, #6E5234 100%)', suit: CrownIcon },
};

/** 道具图标。 */
const ITEM_ICON: Record<string, any> = {
  item_rename: GiftIcon,
  item_counter: BoltIcon,
};

/** 会员权益文案：按商品 id 给，服务端只管天数和价格。 */
const VIP_PERKS: Record<string, string[]> = {
  vip_month:   ['每日签到金币翻倍', '专属会员标识', '牌桌聊天气泡特效'],
  vip_quarter: ['月卡全部权益', '专属牌桌背景', '优先匹配'],
  vip_year:    ['季卡全部权益', '新牌背抢先体验', '专属客服通道'],
};

export function Shop({ onClose, initialCat, onEarnCoins }: ShopProps) {
  const [cat, setCat] = useState<Cat>(() => normalizeCat(initialCat));
  const [data, setData] = useState<ShopData | null>(null);
  const [loading, setLoading] = useState(true);
  /** 正在提交的商品 id，防连点重复扣钱 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [equippedBack, setEquippedBack] = useState<string>(getCardBack);
  /** 金币换星币的输入数量 */
  const [starAmount, setStarAmount] = useState(1);
  /** 房卡兑换数量。 */
  const [cardAmount, setCardAmount] = useState(1);

  const { account } = useAccount();
  const coins = account?.coins ?? 0;
  const stars = account?.stars ?? 0;
  const owned = useMemo(() => new Set(account?.owned ?? []), [account?.owned]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchShop());
    } catch (err) {
      showToast(err instanceof Error ? err.message : '商城加载失败', 'err');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const products = data?.products ?? [];
  const cardBacks = products.filter(p => p.type === 'cardback');
  const items = products.filter(p => p.type === 'item');
  const vips = products.filter(p => p.type === 'vip');
  const coinsPerStar = data?.coinsPerStar ?? 1000;
  const physical = data?.physical;
  // 房卡：兑换价与每日免费额度都由服务端给，不在前端写死
  const roomCardCfg = data?.roomCard ?? { coinsPerCard: 200, exchangeMax: 50, dailyFree: 5 };
  const roomCards = account?.roomCards ?? 0;

  /** 牌背：拥有了就换上（此前买了牌背什么都不会发生）。 */
  const equip = useCallback((name: string) => {
    if ((CARD_BACK_NAMES as readonly string[]).includes(name)) {
      setCardBackPref(name as CardBackName);
      setEquippedBack(name);
      showToast(`已换上「${name}」牌背`, 'ok');
    }
  }, []);

  /** 买东西：一律扣金币，成功后服务端回传新余额，直接写进账号状态。 */
  const handleBuy = useCallback(async (p: ShopProductView) => {
    // 已拥有的牌背 -> 换上；已拥有的道具 -> 提示
    if (owned.has(p.id)) {
      if (p.type === 'cardback') equip(p.name);
      else showToast(`「${p.name}」已在背包里`, 'info');
      return;
    }
    if (!p.enabled) { showToast('该商品暂未开放', 'info'); return; }
    if (p.price > coins) {
      showToast(`金币不足，还差 ${(p.price - coins).toLocaleString()}`, 'err');
      return;
    }
    setBusyId(p.id);
    try {
      const r = await buyProduct(p.id);
      setAccount(r.account);
      if (p.type === 'cardback') equip(p.name);
      else if (p.type === 'vip') showToast(`已开通「${p.name}」`, 'ok');
      else showToast(`已购买「${p.name}」`, 'ok');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '购买失败', 'err');
    } finally {
      setBusyId(null);
    }
  }, [coins, owned, equip]);

  /** 金币换星币。单向不可逆，所以按钮上把汇率写清楚。 */
  const handleExchangeStar = useCallback(async () => {
    const need = starAmount * coinsPerStar;
    if (need > coins) {
      showToast(`金币不足，换 ${starAmount} 星币需要 ${need.toLocaleString()} 金币`, 'err');
      return;
    }
    setBusyId('star');
    try {
      const r = await exchangeStarsApi(starAmount);
      setAccount(r.account);
      showToast(`已兑换 ${starAmount} 星币`, 'ok');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '兑换失败', 'err');
    } finally {
      setBusyId(null);
    }
  }, [starAmount, coinsPerStar, coins]);

  /** 金币换房卡。一次可换多张，省得点 N 次。 */
  const handleExchangeRoomCard = useCallback(async () => {
    const need = cardAmount * roomCardCfg.coinsPerCard;
    if (need > coins) {
      showToast(`金币不足，换 ${cardAmount} 张房卡需要 ${need.toLocaleString()} 金币`, 'err');
      return;
    }
    setBusyId('roomcard');
    try {
      const r = await exchangeRoomCardsApi(cardAmount);
      setAccount(r.account);
      showToast(`已兑换 ${cardAmount} 张房卡`, 'ok');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '兑换失败', 'err');
    } finally {
      setBusyId(null);
    }
  }, [cardAmount, roomCardCfg.coinsPerCard, coins]);

  /** 实物兑换：开关关着就只提示，不发请求。 */
  const handleExchangePhysical = useCallback((g: PhysicalGoodView) => {
    if (!physical?.enabled) {
      showToast(`「${g.name}」兑换即将开放，先攒星币`, 'info');
      return;
    }
    showToast('实物兑换请在活动页填写收货信息', 'info');
  }, [physical?.enabled]);

  return (
    <div className="shop-root">
      {/* 顶 HUD：金币 + 星币。原来金币旁的「+」跳充值，现在跳「赚金币」 */}
      <header className="shop-hud">
        <button className="shop-back" onClick={onClose} aria-label="返回">
          <CloseIcon size={18} tone="gold" />
        </button>
        <h1 className="shop-title">商城</h1>
        <div className="shop-balance">
          <span className="shop-balance-icon"><CoinIcon size={16} /></span>
          <span className="shop-balance-num">{coins.toLocaleString()}</span>
          <button
            className="shop-balance-add"
            onClick={() => {
              if (onEarnCoins) onEarnCoins();
              else showToast('去「活动」签到、看广告都能领金币', 'info');
            }}
            aria-label="赚金币"
          >+</button>
        </div>
        <div className="shop-balance shop-balance--star">
          <span className="shop-balance-icon"><StarIcon size={16} /></span>
          <span className="shop-balance-num">{stars.toLocaleString()}</span>
        </div>
        {/* 房卡也是一种余额，要和金币/星币并列在顶部——
            否则玩家不切到房卡类目就不知道自己有几张。 */}
        <div className="shop-balance shop-balance--card">
          <span className="shop-balance-icon"><TicketIcon size={16} /></span>
          <span className="shop-balance-num">{roomCards.toLocaleString()}</span>
        </div>
      </header>

      <nav className="shop-cats">
        {CATS.map(c => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              className={`shop-cat ${cat === c.id ? 'is-active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              <span className="shop-cat-icon"><Icon size={18} /></span>
              <span className="shop-cat-label">{c.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="shop-body">
        {loading && (
          <div className="shop-loading"><SpinnerIcon size={28} /> 正在读取商城…</div>
        )}

        {!loading && cat === 'cardback' && (
          <div className="shop-section">
            <div className="shop-section-title">牌背皮肤</div>
            <div className="shop-cardback-grid">
              {cardBacks.map(b => {
                const style = BACK_STYLE[b.id] ?? BACK_STYLE.back_blue;
                const Suit = style.suit;
                const isOwned = owned.has(b.id) || b.price === 0;
                const isEquipped = equippedBack === b.name;
                return (
                  <div key={b.id} className={`shop-cardback-item ${isOwned ? 'is-bought' : ''} ${isEquipped ? 'is-equipped' : ''}`}>
                    <div className="shop-cardback-preview" style={{ background: style.color }}>
                      <Suit size={28} tone="gold" />
                    </div>
                    <div className="shop-cardback-name">{b.name}</div>
                    <button
                      className={`shop-cardback-buy ${b.price === 0 ? 'is-free' : ''}`}
                      disabled={busyId === b.id}
                      onClick={() => void handleBuy(b)}
                    >
                      {isEquipped
                        ? <><CheckIcon size={12} /> 使用中</>
                        : isOwned ? '使用'
                          : busyId === b.id ? '处理中…'
                            : <><CoinIcon size={12} /> {b.price.toLocaleString()}</>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && cat === 'item' && (
          <div className="shop-section">
            <div className="shop-section-title">游戏道具</div>
            <div className="shop-item-grid">
              {items.map(it => {
                const Icon = ITEM_ICON[it.id] ?? GiftIcon;
                const isOwned = owned.has(it.id);
                return (
                  <div key={it.id} className={`shop-item-card ${isOwned ? 'is-bought' : ''}`}>
                    <div className="shop-item-icon"><Icon size={28} tone="gold" /></div>
                    <div className="shop-item-name">{it.name}</div>
                    <div className="shop-item-sub">{it.sub}</div>
                    <button
                      className="shop-item-buy"
                      disabled={busyId === it.id}
                      onClick={() => void handleBuy(it)}
                    >
                      {isOwned ? <><CheckIcon size={12} /> 已拥有</>
                        : busyId === it.id ? '处理中…'
                          : <><CoinIcon size={12} /> {it.price.toLocaleString()}</>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && cat === 'vip' && (
          <div className="shop-section">
            <div className="shop-vip-hero">
              <div className="shop-vip-hero-icon"><CrownIcon size={48} tone="gold" goldColor="#A38E84" /></div>
              <h2>五华天王会员</h2>
              {/* 会员用金币开通，不涉及人民币，这句必须写清楚 */}
              <p>用金币开通 · 签到翻倍 · 专属标识</p>
            </div>
            {account?.isVip && (
              <div className="shop-vip-active">
                <CheckIcon size={14} /> 会员有效期至 {new Date(account.vipUntil).toLocaleDateString()}
                <span className="shop-vip-active-hint">继续购买可累加天数</span>
              </div>
            )}
            <div className="shop-vip-grid">
              {vips.map((v, i) => (
                <div key={v.id} className={`shop-vip-card ${i === vips.length - 1 ? 'is-recommend' : ''}`}>
                  {i === vips.length - 1 && <div className="shop-tag is-vip is-hot">最划算</div>}
                  <div className="shop-vip-name">{v.name}</div>
                  <div className="shop-vip-sub">{v.sub}</div>
                  <ul className="shop-vip-perks">
                    {(VIP_PERKS[v.id] ?? []).map((perk, k) => (
                      <li key={k}><span className="shop-vip-perk-bullet">◆</span>{perk}</li>
                    ))}
                  </ul>
                  <button
                    className="shop-vip-buy"
                    disabled={busyId === v.id}
                    onClick={() => void handleBuy(v)}
                  >
                    {busyId === v.id ? '处理中…' : (
                      <>
                        <CoinIcon size={13} /> {v.price.toLocaleString()}
                        <span className="shop-vip-buy-sub">
                          / 约 {Math.round(v.price / (v.days ?? 30))} 金币每天
                        </span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && cat === 'roomcard' && (
          <div className="shop-section">
            <div className="shop-section-title">金币换房卡</div>
            {/* 先把「房卡是干什么的」说清楚：这是新概念，
                不解释的话玩家不知道为何要花 200 金币买一张卡。 */}
            <div className="shop-card-intro">
              <div className="shop-card-intro-title"><TicketIcon size={18} tone="gold" /> 房卡怎么用？</div>
              <ul className="shop-card-intro-list">
                <li>建房时选「房卡局」，<b>扣房主 1 张</b>，同桌其他人免费进。</li>
                <li>房卡局<b>全桌不输赢金币</b>，适合和朋友娱乐。</li>
                <li>但<b>级别、积分、胜率战绩照旧计算</b>，不是白打。</li>
                <li>活动页每天可领 <b>{roomCardCfg.dailyFree} 张免费房卡</b>。</li>
              </ul>
            </div>
            <div className="shop-star-exchange">
              <div className="shop-star-rate">
                <span className="shop-star-rate-from"><CoinIcon size={16} /> {roomCardCfg.coinsPerCard.toLocaleString()}</span>
                <span className="shop-star-rate-arrow">→</span>
                <span className="shop-star-rate-to"><TicketIcon size={16} /> 1</span>
              </div>
              <div className="shop-star-stepper">
                <button
                  onClick={() => setCardAmount(n => Math.max(1, n - 1))}
                  disabled={cardAmount <= 1}
                  aria-label="减少"
                >−</button>
                <span className="shop-star-stepper-num">{cardAmount}</span>
                <button
                  onClick={() => setCardAmount(n => Math.min(roomCardCfg.exchangeMax, n + 1))}
                  disabled={cardAmount >= roomCardCfg.exchangeMax}
                  aria-label="增加"
                >+</button>
              </div>
              <div className="shop-star-cost">
                需 <b>{(cardAmount * roomCardCfg.coinsPerCard).toLocaleString()}</b> 金币
              </div>
              <button
                className="shop-star-btn"
                disabled={busyId === 'roomcard' || cardAmount * roomCardCfg.coinsPerCard > coins}
                onClick={() => void handleExchangeRoomCard()}
              >
                {busyId === 'roomcard' ? '兑换中…'
                  : cardAmount * roomCardCfg.coinsPerCard > coins ? '金币不足'
                    : `兑换 ${cardAmount} 张房卡`}
              </button>
              <div className="shop-star-note">当前拥有 {roomCards} 张。房卡不能换回金币。</div>
            </div>
          </div>
        )}

        {!loading && cat === 'star' && (
          <div className="shop-section">
            {/* 金币 -> 星币 */}
            <div className="shop-section-title">金币换星币</div>
            <div className="shop-star-exchange">
              <div className="shop-star-rate">
                <span className="shop-star-rate-from"><CoinIcon size={16} /> {coinsPerStar.toLocaleString()}</span>
                <span className="shop-star-rate-arrow">→</span>
                <span className="shop-star-rate-to"><StarIcon size={16} /> 1</span>
              </div>
              <div className="shop-star-stepper">
                <button
                  onClick={() => setStarAmount(n => Math.max(1, n - 1))}
                  disabled={starAmount <= 1}
                  aria-label="减少"
                >−</button>
                <span className="shop-star-stepper-num">{starAmount}</span>
                <button
                  onClick={() => setStarAmount(n => Math.min(100, n + 1))}
                  disabled={starAmount >= 100}
                  aria-label="增加"
                >+</button>
              </div>
              <div className="shop-star-cost">
                需 <b>{(starAmount * coinsPerStar).toLocaleString()}</b> 金币
              </div>
              <button
                className="shop-star-btn"
                disabled={busyId === 'star' || starAmount * coinsPerStar > coins}
                onClick={() => void handleExchangeStar()}
              >
                {busyId === 'star' ? '兑换中…'
                  : starAmount * coinsPerStar > coins ? '金币不足'
                    : `兑换 ${starAmount} 星币`}
              </button>
              {/* 单向兑换必须提前讲明白，不然会有人来问怎么换回去 */}
              <div className="shop-star-note">星币只能由金币兑换，不能换回金币。</div>
            </div>

            {/* 星币 -> 实物（后端已实现，入口按计划先锁住） */}
            <div className="shop-section-title" style={{ marginTop: 'calc(18 * var(--u))' }}>
              星币兑好物
              {!physical?.enabled && <span className="shop-soon-tag"><LockedIcon size={11} /> 即将开放</span>}
            </div>
            <div className={`shop-goods-grid ${physical?.enabled ? '' : 'is-locked'}`}>
              {(physical?.goods ?? []).map(g => (
                <div key={g.id} className="shop-goods-card">
                  <div className="shop-goods-icon"><GiftIcon size={26} tone="gold" /></div>
                  <div className="shop-goods-name">{g.name}</div>
                  <div className="shop-goods-sub">{g.sub}</div>
                  <button className="shop-goods-buy" onClick={() => handleExchangePhysical(g)}>
                    <StarIcon size={12} /> {g.stars}
                  </button>
                </div>
              ))}
            </div>
            {!physical?.enabled && (
              <div className="shop-star-note">
                实物兑换正在筹备（含发货与资质），开放后会在公告里通知。现在攒的星币都会保留。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
