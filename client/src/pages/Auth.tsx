// ===== 登录/注册页 v3 =====
// 桌面：左品牌 + 右表单；手机：单列全高表单
// 模式：手机验证码 / 微信 / 游客
// Tab：登录 / 注册
// 风格：深蓝 + 金棕 + 玻璃态 + 4 花色呼吸

import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/auth.css';
import {
  CloseIcon, CrownIcon,
  SpadeIcon, HeartIcon, DiamondIcon, ClubIcon, JokerIcon,
  PhoneIcon, LockIcon, EyeIcon, EyeOffIcon, ShieldIcon,
  WechatIcon, AppleIcon, GuestIcon, UserCircleIcon, VerifyCodeIcon,
  CheckIcon, InfoIcon,
} from '../components/icons';
import { loginGuest, loginPhone } from '../utils/api';
import { setAccount } from '../hooks/useAccount';

interface AuthProps {
  defaultName?: string;
  onClose?: () => void;
  onAuth: (info: { name: string; phone?: string; method: 'phone' | 'wechat' | 'guest' | 'apple' }) => void;
}

type Tab = 'login' | 'register';
type Method = 'phone' | 'wechat' | 'guest' | 'apple';

const SUIT_COMPONENTS: Record<string, any> = {
  spade: SpadeIcon, heart: HeartIcon, diamond: DiamondIcon, club: ClubIcon, joker: JokerIcon,
};

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
function pick<T>(arr: T[], rng: () => number): T { return arr[Math.floor(rng() * arr.length)]; }

// 简单手机号校验
function validPhone(s: string): boolean {
  return /^1[3-9]\d{9}$/.test(s);
}

export function Auth({ defaultName = '', onClose, onAuth }: AuthProps) {
  const [tab, setTab] = useState<Tab>('login');
  const [method, setMethod] = useState<Method>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(defaultName);
  const [showPwd, setShowPwd] = useState(false);
  const [agree, setAgree] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [showAgreement, setShowAgreement] = useState<null | 'user' | 'privacy'>(null);
  // 底部「忘记密码」「遇到问题」此前是死按钮，现在弹一个自助说明
  const [helpKind, setHelpKind] = useState<null | 'forgot' | 'trouble'>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  // 验证码倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // 自动 focus 手机号
  useEffect(() => {
    if (method === 'phone' && tab === 'login' && phoneInputRef.current) {
      setTimeout(() => phoneInputRef.current?.focus(), 400);
    }
  }, [method, tab]);

  const phoneOk = validPhone(phone);
  const codeOk = code.length >= 4;
  const pwdOk = password.length >= 6;
  const nickOk = nickname.trim().length >= 2;

  const canSubmit = useMemo(() => {
    if (!agree) return false;
    if (method === 'phone') {
      if (!phoneOk) return false;
      if (tab === 'login') return codeOk;
      return codeOk && pwdOk && nickOk;
    }
    if (method === 'guest') {
      return tab === 'login' || (tab === 'register' && nickOk);
    }
    // 微信 / Apple 还没接通，按钮不给点，免得点了没反应
    return false;
  }, [agree, method, phoneOk, codeOk, pwdOk, nickOk, tab]);

  const showToast = (kind: 'ok' | 'err' | 'info', text: string, ms = 2200) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), ms);
  };

  // 测试期还没接短信通道，服务端也不校验验证码。这里不能假装"已发送"，
  // 否则用户等短信等不到会以为是 bug。
  const handleSendCode = () => {
    if (!phoneOk) { showToast('err', '请输入正确的手机号'); return; }
    if (countdown > 0) return;
    setCountdown(60);
    showToast('info', '测试期还没接短信，验证码随便填 4-6 位数字即可');
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (!agree) showToast('err', '请先勾选用户协议');
      else if (method === 'phone' && !phoneOk) showToast('err', '手机号格式不正确');
      else if (method === 'phone' && !codeOk) showToast('err', '请输入 4-6 位验证码');
      else if (tab === 'register' && method === 'phone' && !pwdOk) showToast('err', '密码至少 6 位');
      else if (tab === 'register' && method === 'phone' && !nickOk) showToast('err', '昵称至少 2 个字');
      return;
    }
    if (method === 'wechat' || method === 'apple') {
      showToast('info', '微信 / Apple 登录还没接通，先用手机号或游客进');
      return;
    }
    setSubmitting(true);
    try {
      // 真实登录：拿服务端下发的 token，账号里的金币/积分/战绩就跟着人走了。
      // 之前这里是 setTimeout(800) 假装登录，昵称只存在本地。
      const result = method === 'phone'
        ? await loginPhone(phone, tab === 'register' ? nickname.trim() : undefined)
        : await loginGuest(nickname.trim() || undefined);
      setAccount(result.account);
      showToast('ok', tab === 'register' ? '注册成功' : '登录成功');
      onAuth({
        name: result.account.nickname,
        phone: method === 'phone' ? phone : undefined,
        method,
      });
    } catch (e: any) {
      showToast('err', e?.message || '登录失败，请检查网络后重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 背景花色
  const orbitSuits = (['spade', 'heart', 'diamond', 'club'] as const);

  return (
    <div className="auth-root">
      {/* 背景 */}
      <div className="auth-bg">
        <div className="auth-bg-glow g1" />
        <div className="auth-bg-glow g2" />
        <CardRain />
        {/* 4 角落花色 */}
        <div className="auth-corner-suit top-left"><SpadeIcon size={120} tone="gold-deep" /></div>
        <div className="auth-corner-suit top-right"><HeartIcon size={120} tone="gold-deep" /></div>
        <div className="auth-corner-suit bottom-left"><DiamondIcon size={120} tone="gold-deep" /></div>
        <div className="auth-corner-suit bottom-right"><ClubIcon size={120} tone="gold-deep" /></div>
      </div>

      {/* 关闭按钮 */}
      {onClose && (
        <button className="auth-close" onClick={onClose} aria-label="关闭">
          <CloseIcon size={20} tone="gold" />
        </button>
      )}

      <div className="auth-shell">
        {/* === 左侧品牌区 === */}
        <section className="auth-brand">
          <div className="auth-brand-orbit">
            {orbitSuits.map((s, i) => {
              const C = SUIT_COMPONENTS[s];
              return (
                <div key={s} className="auth-brand-orbit-item" style={{ transform: `rotate(${i * 90}deg) translateY(-90px)` }}>
                  <div className="auth-brand-orbit-card" style={{ transform: `rotate(${-i * 90}deg)` }}>
                    <C size={28} tone="gold" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="auth-brand-emblem">
            <div className="auth-brand-emblem-ring r1" />
            <div className="auth-brand-emblem-ring r2" />
            <div className="auth-brand-emblem-ring r3" />
            <div className="auth-brand-emblem-inner">
              <CrownIcon size={48} tone="gold" />
            </div>
          </div>

          <div className="auth-brand-text">
            <div className="auth-brand-title">梅州五华天王</div>
            <div className="auth-brand-sub">MEIZHOU WUHUA · CARD GAME</div>
            <div className="auth-brand-tagline">客家风情 · 智慧竞技</div>
          </div>

          <ul className="auth-brand-feats">
            <li><CheckIcon size={12} tone="green" /> 实时对战 · 全球同服</li>
            <li><CheckIcon size={12} tone="green" /> 多种模式 · 3-6 人局</li>
            <li><CheckIcon size={12} tone="green" /> VIP 福利 · 限定牌背</li>
            <li><CheckIcon size={12} tone="green" /> 公平竞技 · 反外挂</li>
          </ul>
        </section>

        {/* === 右侧表单区 === */}
        <section className="auth-form">
          <div className="auth-form-card">
            <div className="auth-form-glow" />
            {/* Tab 切换 */}
            <div className="auth-tabs">
              <button
                className={`auth-tab ${tab === 'login' ? 'is-active' : ''}`}
                onClick={() => setTab('login')}
              >
                <span>登录</span>
                {tab === 'login' && <div className="auth-tab-bar" />}
              </button>
              <button
                className={`auth-tab ${tab === 'register' ? 'is-active' : ''}`}
                onClick={() => setTab('register')}
              >
                <span>注册</span>
                {tab === 'register' && <div className="auth-tab-bar" />}
              </button>
            </div>

            <div className="auth-form-sub">
              {tab === 'login' ? '欢迎回来，继续你的牌局' : '创建账号，开启五华之旅'}
            </div>

            {/* === 手机验证码 表单 === */}
            {method === 'phone' && (
              <div className="auth-fields">
                {/* 手机号 */}
                <div className={`auth-field ${focused === 'phone' ? 'is-focused' : ''} ${phone && phoneOk ? 'is-valid' : ''}`}>
                  <div className="auth-field-icon"><PhoneIcon size={18} /></div>
                  <div className="auth-field-country">
                    <span>+86</span>
                  </div>
                  <div className="auth-field-divider" />
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="请输入手机号"
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                    onFocus={() => setFocused('phone')}
                    onBlur={() => setFocused(null)}
                    className="auth-input"
                  />
                  {phone && phoneOk && <div className="auth-field-check"><CheckIcon size={16} tone="green" /></div>}
                </div>

                {/* 验证码 */}
                <div className={`auth-field ${focused === 'code' ? 'is-focused' : ''} ${code && codeOk ? 'is-valid' : ''}`}>
                  <div className="auth-field-icon"><VerifyCodeIcon size={18} /></div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="请输入验证码"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    onFocus={() => setFocused('code')}
                    onBlur={() => setFocused(null)}
                    className="auth-input"
                  />
                  <button
                    className={`auth-field-action ${countdown > 0 ? 'is-counting' : ''} ${phoneOk ? 'is-enabled' : ''}`}
                    onClick={handleSendCode}
                    disabled={countdown > 0 || !phoneOk}
                  >
                    {countdown > 0 ? `${countdown}s 重发` : '获取验证码'}
                  </button>
                </div>
                <div className="auth-note">
                  <InfoIcon size={13} tone="gold" />
                  <span>测试期还没接短信通道：验证码随便填 4-6 位数字就能进，手机号就是你的账号。</span>
                </div>

                {/* 注册时：昵称 + 密码 */}
                {tab === 'register' && (
                  <>
                    <div className={`auth-field ${focused === 'nick' ? 'is-focused' : ''} ${nickname && nickOk ? 'is-valid' : ''}`}>
                      <div className="auth-field-icon"><UserCircleIcon size={18} /></div>
                      <input
                        type="text"
                        maxLength={10}
                        placeholder="昵称（2-10 字）"
                        value={nickname}
                        onChange={e => setNickname(e.target.value)}
                        onFocus={() => setFocused('nick')}
                        onBlur={() => setFocused(null)}
                        className="auth-input"
                      />
                      {nickname && nickOk && <div className="auth-field-check"><CheckIcon size={16} tone="green" /></div>}
                    </div>

                    <div className={`auth-field ${focused === 'pwd' ? 'is-focused' : ''} ${password && pwdOk ? 'is-valid' : ''}`}>
                      <div className="auth-field-icon"><LockIcon size={18} /></div>
                      <input
                        type={showPwd ? 'text' : 'password'}
                        maxLength={20}
                        placeholder="密码（至少 6 位）"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onFocus={() => setFocused('pwd')}
                        onBlur={() => setFocused(null)}
                        className="auth-input"
                      />
                      <button
                        className="auth-field-icon-btn"
                        onClick={() => setShowPwd(!showPwd)}
                        aria-label={showPwd ? '隐藏密码' : '显示密码'}
                      >
                        {showPwd ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* === 微信 / Apple：还没接通，如实说明，不摆假二维码 === */}
            {(method === 'wechat' || method === 'apple') && (
              <div className="auth-soon">
                <div className="auth-soon-icon">
                  {method === 'wechat' ? <WechatIcon size={36} /> : <AppleIcon size={36} />}
                </div>
                <div className="auth-soon-title">
                  {method === 'wechat' ? '微信登录' : 'Apple 登录'}暂未开通
                </div>
                <div className="auth-soon-desc">
                  需要平台方审核开放接口，接通后这里会直接出扫码框。
                  现在请用<b>手机号</b>或<b>游客</b>进入，进度和金币都会存在服务器上。
                </div>
                <div className="auth-soon-actions">
                  <button className="auth-soon-btn" onClick={() => setMethod('phone')}>用手机号登录</button>
                  <button className="auth-soon-btn is-ghost" onClick={() => setMethod('guest')}>先用游客玩</button>
                </div>
              </div>
            )}

            {/* === 游客 表单 === */}
            {method === 'guest' && (
              <div className="auth-fields">
                <div className={`auth-field ${focused === 'nick' ? 'is-focused' : ''} ${nickname && nickOk ? 'is-valid' : ''}`}>
                  <div className="auth-field-icon"><UserCircleIcon size={18} /></div>
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="设置昵称（2-10 字）"
                    value={nickname}
                    onChange={e => setNickname(e.target.value)}
                    onFocus={() => setFocused('nick')}
                    onBlur={() => setFocused(null)}
                    className="auth-input"
                  />
                  {nickname && nickOk && <div className="auth-field-check"><CheckIcon size={16} tone="green" /></div>}
                </div>
                <div className="auth-guest-hint">
                  <InfoIcon size={14} tone="gold" />
                  <span>游客账号也存在服务器上（金币、战绩都在）；不过没绑手机号，换设备就找不回来了。</span>
                </div>
              </div>
            )}

            {/* === 协议 === */}
            <label className="auth-agree">
              <span className={`auth-agree-box ${agree ? 'is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={e => setAgree(e.target.checked)}
                />
                {agree && <CheckIcon size={11} tone="dark" />}
              </span>
              <span className="auth-agree-text">
                我已阅读并同意
                <button className="auth-agree-link" onClick={() => setShowAgreement('user')}>《用户协议》</button>
                和
                <button className="auth-agree-link" onClick={() => setShowAgreement('privacy')}>《隐私政策》</button>
              </span>
            </label>

            {/* === 提交 === */}
            <button
              className={`auth-submit ${canSubmit ? 'is-enabled' : ''} ${submitting ? 'is-loading' : ''}`}
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <span className="auth-submit-spinner" />
              ) : (
                <>
                  {tab === 'login' ? '登 录' : '注 册'}
                  <span className="auth-submit-arrow">→</span>
                </>
              )}
            </button>

            {/* === 分割线 === */}
            <div className="auth-divider">
              <span>其他方式</span>
            </div>

            {/* === 快捷登录 === */}
            <div className="auth-quick">
              <button
                className={`auth-quick-btn ${method === 'wechat' ? 'is-active' : ''}`}
                onClick={() => setMethod('wechat')}
                aria-label="微信登录"
              >
                <span className="auth-quick-icon wechat"><WechatIcon size={22} /></span>
                <span className="auth-quick-label">微信</span>
              </button>
              <button
                className={`auth-quick-btn ${method === 'apple' ? 'is-active' : ''}`}
                onClick={() => setMethod('apple')}
                aria-label="Apple 登录"
              >
                <span className="auth-quick-icon apple"><AppleIcon size={22} /></span>
                <span className="auth-quick-label">Apple</span>
              </button>
              <button
                className={`auth-quick-btn ${method === 'guest' ? 'is-active' : ''}`}
                onClick={() => setMethod('guest')}
                aria-label="游客登录"
              >
                <span className="auth-quick-icon guest"><GuestIcon size={22} /></span>
                <span className="auth-quick-label">游客</span>
              </button>
            </div>

            {/* === 底部链接 === */}
            {tab === 'login' && (
              <div className="auth-foot">
                <button className="auth-foot-link" onClick={() => setHelpKind('forgot')}>忘记密码?</button>
                <span className="auth-foot-sep">|</span>
                <button className="auth-foot-link" onClick={() => setHelpKind('trouble')}>遇到问题</button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`auth-toast is-${toast.kind}`}>
          {toast.kind === 'ok' && <CheckIcon size={14} tone="green" />}
          {toast.kind === 'err' && <InfoIcon size={14} tone="red" />}
          {toast.kind === 'info' && <InfoIcon size={14} tone="blue" />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* 忘记密码 / 遇到问题 自助说明 */}
      {helpKind && (
        <AuthHelpModal
          kind={helpKind}
          onClose={() => setHelpKind(null)}
          onUseCode={() => { setHelpKind(null); setMethod('phone'); setTab('login'); showToast('info', '用手机验证码即可直接登录'); }}
        />
      )}

      {/* 协议抽屉 */}
      {showAgreement && (
        <AgreementModal
          kind={showAgreement}
          onClose={() => setShowAgreement(null)}
          onAccept={() => { setAgree(true); setShowAgreement(null); }}
        />
      )}
    </div>
  );
}

// === 卡牌雨 ===
function CardRain() {
  const cards = useMemo(() => {
    const rng = makeRng(7);
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: rng() * 100,
      top: rng() * 100,
      delay: rng() * 12,
      duration: 18 + rng() * 12,
      size: 14 + rng() * 16,
      rot: rng() * 360,
      suit: pick(['spade', 'heart', 'diamond', 'club'] as const, rng),
      opacity: 0.05 + rng() * 0.08,
    }));
  }, []);

  return (
    <div className="auth-rain" aria-hidden>
      {cards.map(c => {
        const C = SUIT_COMPONENTS[c.suit];
        return (
          <div
            key={c.id}
            className="auth-rain-card"
            style={{
              left: `${c.left}%`,
              top: `${c.top}%`,
              width: c.size,
              height: c.size,
              transform: `rotate(${c.rot}deg)`,
              opacity: c.opacity,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
            }}
          >
            <C size={c.size} tone="gold-soft" />
          </div>
        );
      })}
    </div>
  );
}

/** 登录页自助说明：忘记密码 / 遇到问题。 */
function AuthHelpModal({ kind, onClose, onUseCode }: {
  kind: 'forgot' | 'trouble';
  onClose: () => void;
  onUseCode: () => void;
}) {
  const isForgot = kind === 'forgot';
  return (
    <div className="auth-agree-backdrop" onClick={onClose}>
      <div className="auth-agree-modal" onClick={e => e.stopPropagation()}>
        <button className="auth-agree-modal-close" onClick={onClose}><CloseIcon size={16} tone="gold" /></button>
        <div className="auth-agree-modal-icon"><ShieldIcon size={32} tone="gold" /></div>
        <h3>{isForgot ? '忘记密码' : '遇到问题'}</h3>
        <div className="auth-agree-modal-body">
          {isForgot ? (
            <>
              <p>本游戏支持手机验证码直接登录，忘记密码也能进游戏，无需重置。</p>
              <h4>1. 用验证码登录</h4>
              <p>切到「手机号」登录，填手机号后点「获取验证码」，收到后填入即可登录。</p>
              <h4>2. 重设密码</h4>
              <p>验证码登录成功后，到「我的 - 设置」里可以重新设置登录密码。</p>
              <h4>3. 手机号也换了</h4>
              <p>请在「客服与反馈」提交工单，附上昵称、大致注册时间、最近一次对局时间与常用设备信息，我们核实后协助找回。</p>
            </>
          ) : (
            <>
              <p>常见登录问题的自助排查：</p>
              <h4>1. 收不到验证码</h4>
              <p>先检查短信拦截与信号，60 秒后可重发；连续 3 次收不到请改用微信 / 游客登录先进游戏。</p>
              <h4>2. 一直转圈进不去</h4>
              <p>多为网络问题。切换 Wi-Fi / 移动网络后重试，或刷新页面重新连接。</p>
              <h4>3. 提示昵称已被占用</h4>
              <p>换一个 2-10 字的昵称，或在昵称后加数字。</p>
              <h4>4. 其他问题</h4>
              <p>进游戏后到「大厅 - 更多 - 客服与反馈」提交工单，我们 24 小时内回复。</p>
            </>
          )}
        </div>
        <div className="auth-agree-modal-actions">
          <button className="auth-agree-modal-btn secondary" onClick={onClose}>关闭</button>
          <button className="auth-agree-modal-btn primary" onClick={onUseCode}>用验证码登录</button>
        </div>
      </div>
    </div>
  );
}

// === 协议弹窗 ===
function AgreementModal({ kind, onClose, onAccept }: { kind: 'user' | 'privacy'; onClose: () => void; onAccept: () => void }) {
  const isUser = kind === 'user';
  return (
    <div className="auth-agree-backdrop" onClick={onClose}>
      <div className="auth-agree-modal" onClick={e => e.stopPropagation()}>
        <button className="auth-agree-modal-close" onClick={onClose}><CloseIcon size={16} tone="gold" /></button>
        <div className="auth-agree-modal-icon">
          <ShieldIcon size={32} tone="gold" />
        </div>
        <h3>{isUser ? '用户协议' : '隐私政策'}</h3>
        <div className="auth-agree-modal-body">
          {isUser ? (
            <>
              <p>欢迎使用「梅州五华天王」扑克游戏（以下简称"本游戏"）。在使用本游戏前，请仔细阅读本协议。</p>
              <h4>1. 服务内容</h4>
              <p>本游戏提供 3-6 人实时在线扑克对战，包括多种模式和段位系统。本游戏仅供娱乐，不涉及任何形式的赌博或现金交易。</p>
              <h4>2. 用户行为规范</h4>
              <p>用户应遵守中华人民共和国相关法律法规，不得利用本游戏从事任何违法违规活动。不得使用外挂、辅助软件或其他作弊手段。</p>
              <h4>3. 账号管理</h4>
              <p>用户应妥善保管个人账号和密码。因用户原因导致的账号被盗或损失，本游戏不承担责任。</p>
              <h4>4. 虚拟物品</h4>
              <p>游戏内的金币、钻石、VIP 等均为虚拟物品，仅限本游戏内使用，不具备任何现金价值。</p>
            </>
          ) : (
            <>
              <p>本游戏重视用户隐私保护，承诺严格按照本政策收集、使用和保护您的个人信息。</p>
              <h4>1. 信息收集</h4>
              <p>我们仅收集为您提供服务所必需的信息，包括：手机号（用于登录和验证）、昵称、头像、游戏数据等。</p>
              <h4>2. 信息使用</h4>
              <p>您的信息仅用于：账号注册、登录验证、游戏对局、客服支持、反作弊检测等场景。不会用于精准营销或转售给第三方。</p>
              <h4>3. 信息存储</h4>
              <p>您的数据存储在加密服务器上，仅在法律要求或为您提供服务所必需的期限内保留。</p>
              <h4>4. 您的权利</h4>
              <p>您随时可以查看、修改、删除您的个人信息。如需注销账号，请联系客服。</p>
            </>
          )}
        </div>
        <div className="auth-agree-modal-actions">
          <button className="auth-agree-modal-btn secondary" onClick={onClose}>取消</button>
          <button className="auth-agree-modal-btn primary" onClick={onAccept}>我同意</button>
        </div>
      </div>
    </div>
  );
}
