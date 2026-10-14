// ===== 图标名 -> 组件 映射 =====
// 从 icons/index.tsx 抽出：非组件的值导出与组件同文件会破坏 react-refresh 热更新。
// 用于按字符串动态取图标（如配置驱动的菜单项）。

import type React from 'react';
import * as I from './index';

export const Icons: Record<string, React.ForwardRefExoticComponent<any>> = {
  spade: I.SpadeIcon, heart: I.HeartIcon, diamond: I.DiamondIcon, club: I.ClubIcon, joker: I.JokerIcon,
  play: I.PlayIcon, pass: I.PassIcon, hint: I.HintIcon, double: I.DoubleIcon,
  settings: I.SettingsIcon, soundOn: I.SoundOnIcon, soundOff: I.SoundOffIcon,
  back: I.BackIcon, copy: I.CopyIcon, share: I.ShareIcon, close: I.CloseIcon, info: I.InfoIcon,
  crown: I.CrownIcon, coin: I.CoinIcon, trophy: I.TrophyIcon, user: I.UserIcon,
  house: I.HouseIcon, door: I.DoorIcon, cart: I.CartIcon, gamepad: I.GamepadIcon,
  bolt: I.BoltIcon, rank: I.RankIcon, flame: I.FlameIcon, refresh: I.RefreshIcon,
  gift: I.GiftIcon, diamondGem: I.DiamondGemIcon, vip: I.VipIcon, cardBack: I.CardBackIcon,
  plus: I.PlusIcon, check: I.CheckIcon, chevronRight: I.ChevronRightIcon,
  search: I.SearchIcon, filter: I.FilterIcon, chat: I.ChatIcon, smile: I.SmileIcon, send: I.SendIcon,
  calendar: I.CalendarIcon, lineChart: I.LineChartIcon, barChart: I.BarChartIcon, pieChart: I.PieChartIcon,
  arrowUp: I.ArrowUpIcon, arrowDown: I.ArrowDownIcon, winHand: I.WinHandIcon, history: I.HistoryIcon,
  trendUp: I.TrendUpIcon, trendDown: I.TrendDownIcon, spark: I.SparkIcon, target: I.TargetIcon,
  star: I.StarIcon, flag: I.FlagIcon, dig: I.DigIcon,
  radar: I.RadarIcon, pulse: I.PulseIcon, wifi: I.WifiIcon, hourglass: I.HourglassIcon, lightning: I.LightningIcon, mute: I.MuteIcon,
  phone: I.PhoneIcon, lock: I.LockIcon, eye: I.EyeIcon, eyeOff: I.EyeOffIcon, shield: I.ShieldIcon,
  wechat: I.WechatIcon, apple: I.AppleIcon, guest: I.GuestIcon, userCircle: I.UserCircleIcon, key: I.KeyIcon, verifyCode: I.VerifyCodeIcon,
  bell: I.BellIcon, bellOff: I.BellOffIcon, megaphone: I.MegaphoneIcon, pin: I.PinIcon, trending: I.TrendingIcon,
  trash: I.TrashIcon, checkAll: I.CheckAllIcon, mail: I.MailIcon, mailOpen: I.MailOpenIcon, doNotDisturb: I.DoNotDisturbIcon,
  question: I.QuestionIcon, bug: I.BugIcon, lightbulb: I.LightbulbIcon, image: I.ImageIcon, attach: I.AttachIcon,
  group: I.GroupIcon, thumbUp: I.ThumbUpIcon, thumbDown: I.ThumbDownIcon, forward: I.ForwardIcon, warning: I.WarningIcon,
  wallet: I.WalletIcon, qrCode: I.QrCodeIcon, alipay: I.AlipayIcon, wechatPay: I.WechatPayIcon, unionPay: I.UnionPayIcon, qqPay: I.QqPayIcon, applePay: I.ApplePayIcon,
  balance: I.BalanceIcon, spinner: I.SpinnerIcon, fingerprint: I.FingerprintIcon,
  paySuccess: I.PaySuccessIcon, payFailed: I.PayFailedIcon, giftBoom: I.GiftBoomIcon, redPacket: I.RedPacketIcon, order: I.OrderIcon, headset: I.HeadsetIcon,
};
