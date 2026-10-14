// ===== VIP 会员中心 v4 =====
// Hero 当前状态 + 3 档套餐 + 权益对比 + 常见问题 + 底部固定 CTA
//
// v3 -> v4 的关键改动：本项目**没有充值系统**，会员改成用**金币**开通。
// 于是删掉了所有人民币话术（¥30/¥298、「立省 302 元」、「官方直充」、
// 「限时特惠 5 小时倒计时」这种其实永远在倒计时的假紧迫感），
// 价格与天数改为从服务端 /api/shop 拉，开通走 /api/shop/buy 真实扣金币。

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CloseIcon, CrownIcon, VipIcon, CheckIcon, CheckAllIcon, ChevronRightIcon,
  MedalIcon, DiscountIcon, ProgressIcon, UnlockIcon, LockedIcon,
  ShieldIcon, BoltIcon, GiftIcon, ChatIcon, StarIcon, FlameIcon, DiamondGemIcon,
  CalendarIcon, PhoneIcon, HeadsetIcon, ArrowUpIcon,
} from '../components/icons';
import { fetchShop, buyProduct, type ShopProductView } from '../utils/api';
import { useAccount, setAccount } from '../hooks/useAccount';
import { showToast } from '../utils/toast';
import { CoinIcon } from '../components/icons';
import '../styles/vipCenter.css';

interface VipCenterProps {
  onClose: () => void;
  /** 金币不够时引导去赚金币（活动页签到/看广告）。 */
  onEarnCoins?: () => void;
}

// ===== 套餐数据 =====
// 价格与天数是服务端口径（economy.ts 的 SHOP_PRODUCTS），这里只放展示文案。
interface VipPlanMeta {
  /** 服务端商品 id */
  id: string;
  name: string;
  sub: string;
  badge?: string;
  tag?: string;
  tagColor?: 'gold' | 'hot' | 'new';
  perks: string[];
  /** 对比表里覆盖的 perk id */
  perkIds: string[];
}

const PLAN_META: VipPlanMeta[] = [
  {
    id: 'vip_month', name: '月卡', sub: '30 天',
    tag: '入门', tagColor: 'gold',
    perks: ['每日签到金币翻倍', '专属会员标识', '聊天气泡特效'],
    perkIds: ['coin', 'badge2', 'chat'],
  },
  {
    id: 'vip_quarter', name: '季卡', sub: '90 天',
    tag: '更划算', tagColor: 'hot', badge: '人气之选',
    perks: ['月卡全部权益', '专属牌桌背景', '优先匹配', '每月 1 张改名卡'],
    perkIds: ['coin', 'badge2', 'chat', 'back', 'match', 'card'],
  },
  {
    id: 'vip_year', name: '年卡', sub: '365 天',
    tag: '最划算', tagColor: 'gold', badge: '长期玩家',
    perks: ['季卡全部权益', '新牌背抢先体验', '专属客服通道', '生日礼包', '专属成就徽章'],
    perkIds: ['coin', 'badge2', 'chat', 'back', 'match', 'card', 'cardback', 'bday', 'medal'],
  },
];

/** 服务端商品 + 展示文案合成一条套餐。 */
interface VipPlan extends VipPlanMeta {
  /** 金币价 */
  price: number;
  days: number;
  /** 每天折合多少金币 */
  perDay: number;
  enabled: boolean;
}

function mergePlans(products: ShopProductView[]): VipPlan[] {
  const plans: VipPlan[] = [];
  for (const meta of PLAN_META) {
    const p = products.find(x => x.id === meta.id);
    if (!p) continue;
    const days = p.days ?? 30;
    plans.push({
      ...meta,
      price: p.price,
      days,
      perDay: Math.round(p.price / days),
      enabled: p.enabled,
    });
  }
  return plans;
}

// 全部权益（对比表用）
const ALL_PERKS = [
  { id: 'coin',     name: '每日签到金币翻倍', icon: 'coin' },
  { id: 'badge2',   name: '专属会员标识',     icon: 'medal' },
  { id: 'chat',     name: '聊天气泡特效',     icon: 'chat' },
  { id: 'back',     name: '专属牌桌背景',     icon: 'image' },
  { id: 'match',    name: '优先匹配',         icon: 'bolt' },
  { id: 'card',     name: '每月改名卡',       icon: 'gift' },
  { id: 'cardback', name: '新牌背抢先',       icon: 'star' },
  { id: 'bday',     name: '生日礼包',         icon: 'gift' },
  { id: 'medal',    name: '专属成就徽章',     icon: 'medal' },
] as const;

type IcoName = 'coin' | 'image' | 'chat' | 'gift' | 'bolt' | 'phone' | 'star' | 'medal';
const PERK_ICON: Record<IcoName, any> = {
  coin: DiamondGemIcon, image: VipIcon, chat: ChatIcon, gift: GiftIcon,
  bolt: BoltIcon, phone: PhoneIcon, star: StarIcon, medal: MedalIcon,
};

// ===== FAQ =====
// 全部按"金币开通、无充值"的口径重写；原来那套「支付/退款/自动续费」
// 在没有支付系统的产品里全是误导。
const FAQS = [
  { q: '会员怎么开通？', a: '会员用金币开通，不需要充钱。金币可以靠赢牌、每日签到、看广告获得，攒够了在这里直接开。' },
  { q: '开通后什么时候生效？', a: '点开通、金币扣掉的那一刻就生效，不用手动激活。有效期在页面顶部和「我的」里都能看到。' },
  { q: '已经是会员，再买会怎样？', a: '天数会累加，不会覆盖。比如还剩 10 天时再开月卡，到期时间会变成 40 天后。' },
  { q: '到期后会自动扣金币续费吗？', a: '不会。到期就自动变回普通用户，任何情况下都不会自动扣你的金币。' },
  { q: '会员到期后，签到领的金币还在吗？', a: '在。会员只影响签到的倍率，已经领到手的金币永久保留。' },
  { q: '换设备后会员还在吗？', a: '手机号登录的账号，会员和金币都跟着账号走。游客账号只存在本机，换设备会找不回来，建议绑手机号。' },
  { q: '金币怎么攒得快一些？', a: '赢牌是主要来源（赢的级数越多给得越多，庄家赢和挖底成功还有额外奖励），再加上每天签到和看广告。' },
  { q: '会员能兑换实物吗？', a: '实物要用星币兑换，星币由金币兑换而来。实物兑换目前还没开放，开放后会公告。' },
];

export function VipCenter({ onClose, onEarnCoins }: VipCenterProps) {
  const [planId, setPlanId] = useState<string>('vip_quarter');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [plans, setPlans] = useState<VipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const { account } = useAccount();
  const coins = account?.coins ?? 0;
  const isVip = Boolean(account?.isVip);
  const vipUntil = account?.vipUntil ?? 0;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await fetchShop();
        if (!alive) return;
        setPlans(mergePlans(data.products));
      } catch (err) {
        showToast(err instanceof Error ? err.message : '套餐加载失败', 'err');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const selected = useMemo(
    () => plans.find(p => p.id === planId) ?? plans[0] ?? null,
    [plans, planId],
  );

  /** 会员剩余天数，用于 hero 区显示真实状态。 */
  const daysLeft = useMemo(() => {
    if (!isVip) return 0;
    return Math.max(0, Math.ceil((vipUntil - Date.now()) / 86400_000));
  }, [isVip, vipUntil]);

  /** 非会员时进度条的含义：离最便宜那档还差多少金币（攒钱进度）。 */
  const cheapestProgress = useMemo(() => {
    const cheapest = plans.reduce((min, p) => (p.price < min ? p.price : min), Infinity);
    if (!Number.isFinite(cheapest) || cheapest <= 0) return 0;
    return Math.min(100, Math.round((coins / cheapest) * 100));
  }, [plans, coins]);

  const handleBuy = useCallback(async (plan: VipPlan) => {
    if (!plan.enabled) { showToast('该套餐暂未开放', 'info'); return; }
    if (plan.price > coins) {
      showToast(`金币不足，还差 ${(plan.price - coins).toLocaleString()}`, 'err');
      onEarnCoins?.();
      return;
    }
    setBuyingId(plan.id);
    try {
      const r = await buyProduct(plan.id);
      setAccount(r.account);
      showToast(`已开通「${plan.name}」，有效期至 ${new Date(r.account.vipUntil).toLocaleDateString()}`, 'ok');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '开通失败', 'err');
    } finally {
      setBuyingId(null);
    }
  }, [coins, onEarnCoins]);

  return (
    <div className="vipc-root">
      {/* 顶 HUD */}
      <header className="vipc-hud">
        <button className="vipc-back" onClick={onClose} aria-label="返回">
          <CloseIcon size={18} tone="gold" />
        </button>
        <h1 className="vipc-title">
          <CrownIcon size={20} tone="gold" goldColor="#A38E84" />
          <span>VIP 会员中心</span>
        </h1>
        <div className="vipc-hud-right">
          {/* 原来这里写「官方直充」——没有支付系统，会员是金币开的，改成显示余额 */}
          <div className="vipc-hud-tag">
            <CoinIcon size={12} tone="gold" />
            <span>{coins.toLocaleString()}</span>
          </div>
        </div>
      </header>

      <div className="vipc-body">
        {/* === Hero 当前状态 === */}
        <section className="vipc-hero">
          <div className="vipc-hero-bg" />
          <div className="vipc-hero-bg-rays" />
          <div className="vipc-hero-content">
            <div className="vipc-hero-avatar">
              <CrownIcon size={64} tone="gold" goldColor="#F5E6C4" />
            </div>
            <div className="vipc-hero-info">
              {/* 会员状态用账号真实数据，而不是永远显示「未开通」 */}
              <div className="vipc-hero-level">{isVip ? '会员' : '普通用户'}</div>
              <div className="vipc-hero-name">
                {isVip ? `有效期至 ${new Date(vipUntil).toLocaleDateString()}` : '未开通会员'}
              </div>
              <div className="vipc-hero-progress">
                <div className="vipc-hero-progress-label">
                  <span>
                    {isVip
                      ? `还剩 ${daysLeft} 天，继续购买可累加`
                      : `用金币开通，解锁 ${ALL_PERKS.length} 项权益`}
                  </span>
                  {/* 进度条对会员表示"这一年过了多少"，对非会员表示离最便宜套餐还差多少金币 */}
                  <span className="vipc-hero-progress-pct">
                    {isVip
                      ? `${Math.min(100, Math.round((daysLeft / 365) * 100))}%`
                      : `${cheapestProgress}%`}
                  </span>
                </div>
                <div className="vipc-hero-progress-bar">
                  <div
                    className="vipc-hero-progress-fill"
                    style={{ width: `${isVip ? Math.min(100, Math.round((daysLeft / 365) * 100)) : cheapestProgress}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="vipc-hero-stat">
              <div className="vipc-hero-stat-num">{ALL_PERKS.length}</div>
              <div className="vipc-hero-stat-label">专属权益</div>
            </div>
          </div>
        </section>

        {/* 原来这里是「限时特惠 5 小时倒计时」——每次进来都在倒计时，等于假紧迫感。
            换成一句真的有用的话：金币从哪来。 */}
        <section className="vipc-promo">
          <div className="vipc-promo-flame">
            <FlameIcon size={18} tone="gold" />
          </div>
          <div className="vipc-promo-content">
            <div className="vipc-promo-title">会员用金币开通，不花钱</div>
            <div className="vipc-promo-sub">赢牌、每日签到、看广告都能攒金币</div>
          </div>
          <button
            className="vipc-promo-cta"
            onClick={() => (onEarnCoins ? onEarnCoins() : showToast('去「活动」签到、看广告都能领金币', 'info'))}
          >去赚金币</button>
        </section>

        {/* === 3 档套餐 === */}
        <section className="vipc-plans">
          <div className="vipc-section-hud">
            <h2 className="vipc-section-title">选择套餐</h2>
            <div className="vipc-section-tag">
              <DiscountIcon size={14} tone="gold" />
              <span>天数可累加</span>
            </div>
          </div>

          <div className="vipc-plan-grid">
            {plans.map(plan => {
              const isActive = planId === plan.id;
              return (
                <button
                  key={plan.id}
                  className={`vipc-plan ${isActive ? 'is-active' : ''} ${plan.tagColor === 'hot' ? 'is-hot' : ''} ${plan.badge ? 'is-recommend' : ''}`}
                  onClick={() => setPlanId(plan.id)}
                >
                  {plan.badge && <div className="vipc-plan-badge">{plan.badge}</div>}
                  {plan.tag && (
                    <div className={`vipc-plan-tag vipc-plan-tag--${plan.tagColor || 'gold'}`}>
                      {plan.tag}
                    </div>
                  )}

                  <div className="vipc-plan-head">
                    <div className="vipc-plan-name">{plan.name}</div>
                    <div className="vipc-plan-sub">{plan.sub}</div>
                  </div>

                  <div className="vipc-plan-price">
                    <span className="vipc-plan-currency"><CoinIcon size={14} tone="gold" /></span>
                    <span className="vipc-plan-value">{plan.price.toLocaleString()}</span>
                  </div>
                  <div className="vipc-plan-price-meta">
                    <span className="vipc-plan-perday">约 {plan.perDay} 金币 / 天</span>
                  </div>

                  {/* 金币不够就明确写出还差多少，别让人点了才知道 */}
                  {plan.price > coins && (
                    <div className="vipc-plan-highlight">还差 {(plan.price - coins).toLocaleString()} 金币</div>
                  )}

                  <div className="vipc-plan-divider" />

                  <ul className="vipc-plan-perks">
                    {plan.perks.map((p, i) => (
                      <li key={i} className="vipc-plan-perk">
                        <CheckIcon size={12} tone="gold" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>

                  <div className={`vipc-plan-radio ${isActive ? 'is-active' : ''}`}>
                    {isActive ? <CheckIcon size={14} tone="dark" /> : null}
                    <span>{isActive ? '已选择' : '选择'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* === 权益对比 === */}
        <section className="vipc-compare">
          <div className="vipc-section-hud">
            <h2 className="vipc-section-title">权益对比</h2>
            <div className="vipc-section-tag vipc-section-tag--mute">
              <ProgressIcon size={14} tone="gold-soft" />
              <span>9 项特权</span>
            </div>
          </div>

          <div className="vipc-compare-table">
            <div className="vipc-compare-head">
              <div className="vipc-compare-cell vipc-compare-cell--name">特权</div>
              {plans.map(p => (
                <div key={p.id} className={`vipc-compare-cell vipc-compare-cell--head ${p.badge ? 'is-hot' : ''}`}>
                  {p.name}
                </div>
              ))}
            </div>
            {ALL_PERKS.map(pk => {
              const Ico = PERK_ICON[pk.icon as IcoName];
              return (
                <div key={pk.id} className="vipc-compare-row">
                  <div className="vipc-compare-cell vipc-compare-cell--name">
                    <span className="vipc-compare-icon"><Ico size={14} tone="gold" /></span>
                    <span>{pk.name}</span>
                  </div>
                  {plans.map(p => {
                    const has = p.perkIds.includes(pk.id);
                    return (
                      <div key={p.id} className={`vipc-compare-cell vipc-compare-cell--val ${has ? 'is-on' : 'is-off'}`}>
                        {has ? <UnlockIcon size={16} tone="green" /> : <LockedIcon size={16} tone="mute" />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>

        {/* === 续费说明 === */}
        <section className="vipc-renew">
          <div
            className="vipc-renew-card"
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => setOpenFaq(FAQS.findIndex(f => f.q.includes('累加')))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenFaq(FAQS.findIndex(f => f.q.includes('累加'))); }}
          >
            <div className="vipc-renew-icon">
              <CalendarIcon size={20} tone="gold" />
            </div>
            <div className="vipc-renew-info">
              {/* 原来写「续费 8.5 折 / 7 折」，但没有折扣机制；真正的规则是天数累加 */}
              <div className="vipc-renew-title">会员期内再买，天数直接累加</div>
              <div className="vipc-renew-sub">不覆盖、不浪费；到期自动变回普通用户，不会自动扣金币</div>
            </div>
            <div className="vipc-renew-arrow">
              <ChevronRightIcon size={16} tone="gold-soft" />
            </div>
          </div>
        </section>

        {/* === FAQ === */}
        <section className="vipc-faq">
          <div className="vipc-section-hud">
            <h2 className="vipc-section-title">常见问题</h2>
            <div className="vipc-section-tag vipc-section-tag--mute">
              <HeadsetIcon size={14} tone="gold-soft" />
              <span>8 条解答</span>
            </div>
          </div>
          <div className="vipc-faq-list">
            {FAQS.map((f, i) => (
              <div key={i} className={`vipc-faq-item ${openFaq === i ? 'is-open' : ''}`}>
                <button
                  className="vipc-faq-q"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="vipc-faq-q-num">Q{(i + 1).toString().padStart(2, '0')}</span>
                  <span className="vipc-faq-q-text">{f.q}</span>
                  <span className="vipc-faq-q-icon">
                    <ChevronRightIcon size={16} tone="gold" />
                  </span>
                </button>
                {openFaq === i && (
                  <div className="vipc-faq-a">
                    <div className="vipc-faq-a-num">A</div>
                    <div className="vipc-faq-a-text">{f.a}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 说明条：全部换成本项目真实成立的事实，不再写支付相关话术 */}
        <section className="vipc-trust">
          <div className="vipc-trust-item">
            <ShieldIcon size={20} tone="green" />
            <div className="vipc-trust-text">
              <div className="vipc-trust-title">不用充钱</div>
              <div className="vipc-trust-sub">金币靠玩获得</div>
            </div>
          </div>
          <div className="vipc-trust-item">
            <CheckAllIcon size={20} tone="green" />
            <div className="vipc-trust-text">
              <div className="vipc-trust-title">即时生效</div>
              <div className="vipc-trust-sub">开通立刻可用</div>
            </div>
          </div>
          <div className="vipc-trust-item">
            <CalendarIcon size={20} tone="gold" />
            <div className="vipc-trust-text">
              <div className="vipc-trust-title">天数累加</div>
              <div className="vipc-trust-sub">续开不浪费</div>
            </div>
          </div>
          <div className="vipc-trust-item">
            <HeadsetIcon size={20} tone="gold" />
            <div className="vipc-trust-text">
              <div className="vipc-trust-title">不自动扣费</div>
              <div className="vipc-trust-sub">到期自然结束</div>
            </div>
          </div>
        </section>
      </div>

      {/* === 底部固定 CTA === */}
      {/* 套餐还没加载出来时不渲染，避免 selected 为空导致白屏 */}
      {selected && (
        <footer className="vipc-cta-bar">
          <div className="vipc-cta-bar-info">
            <div className="vipc-cta-bar-name">
              {selected.name}
              {selected.badge && <span className="vipc-cta-bar-tag">{selected.badge}</span>}
            </div>
            <div className="vipc-cta-bar-price">
              <span className="vipc-cta-bar-currency"><CoinIcon size={15} tone="gold" /></span>
              <span className="vipc-cta-bar-value">{selected.price.toLocaleString()}</span>
              <span className="vipc-cta-bar-perday">约 {selected.perDay} / 天</span>
            </div>
          </div>
          <button
            className="vipc-cta-bar-btn"
            disabled={buyingId === selected.id}
            onClick={() => void handleBuy(selected)}
          >
            <span>
              {buyingId === selected.id ? '开通中…'
                : selected.price > coins ? '金币不足'
                  : isVip ? '续开会员' : '立即开通'}
            </span>
            <ArrowUpIcon size={16} tone="dark" />
          </button>
        </footer>
      )}
      {loading && <div className="vipc-loading">正在读取套餐…</div>}
    </div>
  );
}
