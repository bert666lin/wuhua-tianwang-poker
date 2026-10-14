// ===== 规则弹窗 v3 =====
// 蓝+金玻璃态 + accordion 章节

import { useEffect, useState } from 'react';
import { CloseIcon, SpadeIcon, DiamondIcon, CrownIcon, BoltIcon, GamepadIcon } from './icons';
import '../styles/rulesModal.css';

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    icon: 'cards',
    title: '基本规则',
    body: (
      <>
        <p>使用 <strong>两副或三副牌</strong>，3-6 人对战，<strong>一方做庄</strong>，其余为闲家。</p>
        <p>每局开始：发牌 → 叫主（亮 7）→ 叫分（从基准分往下叫）→ 扣底 → 出牌 → 结算。</p>
      </>
    ),
  },
  {
    icon: 'star',
    title: '主牌与天王',
    body: (
      <>
        <p><strong>主花色</strong>：由对应花色的 7 叫定，无人叫主时由底牌翻定。</p>
        <p><strong>天王</strong>：主花色的 3，是全场最大的单牌；随主花色变化。</p>
        <p><strong>主牌</strong>：主花色全部 + 大小王 + 所有花色的 7 和 2。</p>
      </>
    ),
  },
  {
    icon: 'crown',
    title: '叫主与抢主',
    body: (
      <>
        <p><strong>叫主</strong>：亮出手上对应花色的 <strong>7</strong> 即可定主，亮出的 7 仍留在手牌中。</p>
        <p><strong>抢主</strong>：后叫的人必须比前一家多亮一张同花色的 7。例如前家用 1 张♦7 叫主，
          想抢主就要亮 <strong>2 张</strong>同花色的 7。</p>
        <p>系统只会替你亮到刚好够的张数，多余的 7 留在手上不暴露。</p>
        <p>无人叫主时翻底牌第 6 张定主；翻到<strong>大王算红桃</strong>，<strong>小王算黑桃</strong>。</p>
      </>
    ),
  },
  {
    icon: 'crown',
    title: '庄家与叫分',
    body: (
      <>
        <p><strong>起叫分</strong>：两副牌从 <strong>125</strong> 分起叫，三副牌从 <strong>145</strong> 分起叫；
          最低 40 分，步长 5 分。</p>
        <p>一人一次机会，<strong>后叫必须更低</strong>，叫到 40 立即结束。叫分最低者成为庄家并获得底牌。</p>
        <p>闲家总分需达到或超过庄家叫分才能打倒庄家。</p>
        <p><strong>满一级分</strong>：双副 125 分，三副 145 分；每多 45 分升一级，封顶 4 级。</p>
        <p>全员不叫分则<strong>流局</strong>，主牌最多者视为庄家并输一级。</p>
      </>
    ),
  },
  {
    icon: 'bolt',
    title: '底牌分与挖底',
    body: (
      <>
        <p><strong>底牌分</strong>：只要<strong>闲家赢下最后一墩</strong>，底牌分就计入闲家，
          用普通牌赢也算。庄家赢下最后一墩，底牌分不计入闲家。</p>
        <p><strong>挖底保底级</strong>：闲家还要用<strong>天王或大小王</strong>赢下最后一墩，才额外拿保底级数。</p>
        <p>1 张天王保底 3 级，2 张及以上封顶 4 级；仅大小王保底 1 级。</p>
        <p>用普通牌赢最后一墩<strong>没有保底级</strong>，仍要靠总分（已含底牌分）达到叫分才算赢。</p>
      </>
    ),
  },
  {
    icon: 'cards',
    title: '合法牌型',
    body: (
      <>
        <p><strong>单张</strong> / <strong>对子</strong>（两张完全相同）/ <strong>三张</strong>（三张完全相同）。</p>
        <p><strong>连对</strong>：同花色连续对子，2 组起，组数不限。
          如 33+44、33+44+55+66；允许 K-A-2-3 跨接。</p>
        <p><strong>连三张</strong>：同花色连续三张，2 组起。如 444+555、444+555+666。</p>
        <p><strong>王组合</strong>：大王组 + 小王组且两组张数相同。如大王对+小王对、三大王+三小王。
          王组合能压同张数的连对和连三张。</p>
        <p className="rules-warn"><strong>主牌和副牌不能一起成组出。</strong>
          7 和 2 是常主（主牌），所以副花色连对不能含 7 或 2，也不能跨过它们接续。
          例如主是♠时，♦6♦6+♦7♦7 不成立（♦7是主牌、♦6是副牌）；主是♦时整手都是主牌，就成立。
          但 ♦6♦6+♦8♦8 <strong>在任何主牌下都不成立</strong>——中间跳过了 7，点数不连续。</p>
        <p>组合牌型按<strong>牌面点数</strong>比大小。主花色的 3 是天王，
          但在连对/连三张里只按点数 3 参与，单出或出对子、三张时才是最大牌。</p>
        <p>不支持顺子。</p>
      </>
    ),
  },
  {
    icon: 'play',
    title: '出牌与跟牌',
    body: (
      <>
        <p>首家<strong>领出</strong>，后家必须<strong>跟牌</strong>：有首家花色尽量跟足，不足可垫副牌。</p>
        <p>副牌缺时可<strong>杀牌</strong>：用匹配牌型结构的主牌争胜。</p>
        <p><strong>甩牌</strong>：<strong>每一墩先出牌的人</strong>都可以甩牌（上一墩的赢家领出下一墩，
          所以不是只有开局能甩）；跟牌的人不能甩。</p>
        <p>甩出同一门里最大的若干张，不需要成对。若他人手上该门有更大的牌，
          甩牌失败，只打出所甩牌中最小的一张，本墩按单张继续。</p>
        <p>任一玩家打出最后手牌不中断本墩，整墩打完后整局结束。</p>
      </>
    ),
  },
];

export function RulesModal({ open, onClose }: RulesModalProps) {
  const [expanded, setExpanded] = useState<number | null>(0);

  // Esc 关闭。注意 Hook 必须在 early return 之前，否则违反 Hooks 规则。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="rules-backdrop" onClick={onClose}>
      <div className="rules-modal" onClick={e => e.stopPropagation()}>
        <header className="rules-head">
          <h2 className="rules-title"><GamepadIcon size={20} tone="gold" /> 玩法说明</h2>
          <button className="rules-close" onClick={onClose} aria-label="关闭"><CloseIcon size={18} /></button>
        </header>
        <div className="rules-body">
          {SECTIONS.map((s, i) => {
            const isOpen = expanded === i;
            return (
              <div key={i} style={{
                border: '1px solid var(--c-border-soft)',
                borderRadius: 'var(--r-md)',
                marginBottom: 8,
                overflow: 'hidden',
                background: isOpen ? 'rgba(110, 131, 181, 0.08)' : 'rgba(15, 26, 46, 0.4)',
              }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : i)}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'transparent', border: 'none',
                    color: isOpen ? 'var(--c-text-gold)' : 'var(--c-text)',
                    fontSize: 14, fontWeight: 800,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {s.icon === 'cards' ? <SpadeIcon size={14} tone="gold" /> :
                       s.icon === 'star' ? <DiamondIcon size={14} /> :
                       s.icon === 'crown' ? <CrownIcon size={14} tone="gold" /> :
                       s.icon === 'bolt' ? <BoltIcon size={14} tone="gold" /> :
                       <GamepadIcon size={14} tone="gold" />}
                      {s.title}
                    </span>
                  <span style={{
                    transition: 'transform 0.2s',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                    color: 'var(--c-text-dim)',
                  }}>▾</span>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 16px 14px', color: 'var(--c-text-mute)', fontSize: 13, lineHeight: 1.7 }}>
                    {s.body}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: 20, padding: 12, background: 'rgba(110, 131, 181, 0.12)', border: '1px solid var(--c-border-soft)', borderRadius: 'var(--r-md)', fontSize: 12, color: 'var(--c-text-dim)' }}>
            {/* 原文写「详见项目根目录 RULES.md」—— 玩家看不到源码目录，
                这句话对他们毫无意义，且路径也不对（文档在 docs/）。
                换成对玩家真正有用的信息。 */}
            💡 规则如有疑问，可在「大厅 - 更多 - 客服与反馈」提交工单
          </div>
        </div>
      </div>
    </div>
  );
}
