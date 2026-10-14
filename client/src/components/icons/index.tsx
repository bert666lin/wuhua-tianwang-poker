// ===== 自定义图标库 v3 =====
// 风格：线型 + 圆角端点，部分双色 (蓝+金)，统一 24x24 viewBox
// 用法：<SpadeIcon size={20} /> 或 <Icon name="diamond" size={20} />（Icon 见 ./Icon.tsx）

import { forwardRef, type SVGProps } from 'react';

export type IconTone = 'default' | 'gold' | 'gold-soft' | 'gold-deep' | 'blue' | 'blue-soft' | 'mute' | 'soft' | 'red' | 'red-soft' | 'green' | 'warn' | 'dark' | 'white';

const TONE_MAP: Record<IconTone, string> = {
  'default':   'var(--icon-default)',
  'gold':      'var(--icon-gold)',
  'gold-soft': 'var(--icon-gold-soft)',
  'gold-deep': 'var(--icon-gold-deep)',
  'blue':      'var(--icon-blue)',
  'blue-soft': 'var(--icon-blue-soft)',
  'mute':      'var(--icon-mute)',
  'soft':      'var(--icon-soft)',
  'red':       'var(--icon-red)',
  'red-soft':  'var(--icon-red-soft)',
  'green':     'var(--icon-green)',
  'warn':      'var(--icon-warn)',
  'dark':      'var(--icon-dark)',
  'white':     'var(--icon-white)',
};

export type IconProps = {
  size?: number | string;
  className?: string;
  color?: string;
  /** 语义色调，会被映射为对应 token 颜色（优先级低于 color） */
  tone?: IconTone;
  goldColor?: string;
  strokeWidth?: number;
} & Omit<SVGProps<SVGSVGElement>, 'color'>;

/** 解析最终颜色：color > tone > default */
function resolveColor(color: string | undefined, tone: IconTone | undefined): string {
  if (color !== undefined) return color;
  if (tone && tone !== 'default') return TONE_MAP[tone];
  return 'currentColor';
}

const baseProps = (size: number | string = 24): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
});

const sw = 1.6;

// === 花色 (蓝+金 双色风格) ===
export const SpadeIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 3 L4.5 11.5 a4.5 4.5 0 0 0 4.5 6.5 a3 3 0 0 0 3 -1.5 a3 3 0 0 0 3 1.5 a4.5 4.5 0 0 0 4.5 -6.5 z"
      fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 18 q-1 2 2 3 q3 -1 2 -3" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    {goldColor && <circle cx="12" cy="11" r="1.2" fill={goldColor} />}
  </svg>
  );
  }
);
SpadeIcon.displayName = 'SpadeIcon';

export const HeartIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 20 C5 14 3 10 3 7.5 a4 4 0 0 1 7.5 -2 a4 4 0 0 1 7.5 2 c0 2.5 -2 6.5 -6 12.5 z"
      fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    {goldColor && <circle cx="12" cy="7.5" r="1.2" fill={goldColor} />}
  </svg>
  );
  }
);
HeartIcon.displayName = 'HeartIcon';

export const DiamondIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 3 L20 12 L12 21 L4 12 z" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    {goldColor && <circle cx="12" cy="12" r="1.2" fill={goldColor} />}
  </svg>
  );
  }
);
DiamondIcon.displayName = 'DiamondIcon';

export const ClubIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="8" r="4" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="7" cy="14" r="4" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="17" cy="14" r="4" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 17 q-1 2 2 4 q3 -2 2 -4" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    {goldColor && <circle cx="12" cy="8" r="1.2" fill={goldColor} />}
  </svg>
  );
  }
);
ClubIcon.displayName = 'ClubIcon';

export const JokerIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="4" y="4" width="16" height="16" rx="3" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="900" fill={finalColor} fontFamily="serif">★</text>
  </svg>
  );
  }
);
JokerIcon.displayName = 'JokerIcon';

// === 操作类 ===
export const PlayIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth: _strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M7 5 L19 12 L7 19 z" fill={finalColor} />
  </svg>
  );
  }
);
PlayIcon.displayName = 'PlayIcon';

export const PassIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 8 L16 16 M16 8 L8 16" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
PassIcon.displayName = 'PassIcon';

export const HintIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 2 a7 7 0 0 1 4 12.5 V18 a2 2 0 0 1 -2 2 h-4 a2 2 0 0 1 -2 -2 v-3.5 A7 7 0 0 1 12 2 z"
      fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 21 h4" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="9" r="1.2" fill={finalColor} />
  </svg>
  );
  }
);
HintIcon.displayName = 'HintIcon';

export const DoubleIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M13 2 L4 14 h7 l-2 8 l10 -12 h-7 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
DoubleIcon.displayName = 'DoubleIcon';

export const SettingsIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="3" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 -2.83 2.83l-.06-.06a1.65 1.65 0 0 0 -1.82-.33 1.65 1.65 0 0 0 -1 1.51V21a2 2 0 0 1 -4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0 -1.82.33l-.06.06a2 2 0 0 1 -2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0 -1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0 -.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 -.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0 -1.51 1z"
      stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
SettingsIcon.displayName = 'SettingsIcon';

export const SoundOnIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M11 5 L6 9 H2 v6 h4 l5 4 z" fill={finalColor} />
    <path d="M15.5 8.5 a5 5 0 0 1 0 7 M19 5 a9 9 0 0 1 0 14" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
SoundOnIcon.displayName = 'SoundOnIcon';

export const SoundOffIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M11 5 L6 9 H2 v6 h4 l5 4 z" fill={finalColor} />
    <path d="M15.5 8.5 a5 5 0 0 1 0 7" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M22 9 l-6 6 M16 9 l6 6" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
SoundOffIcon.displayName = 'SoundOffIcon';

export const BackIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M15 5 L8 12 L15 19" stroke={finalColor} strokeWidth={strokeWidth + 0.4} fill="none" />
  </svg>
  );
  }
);
BackIcon.displayName = 'BackIcon';

export const CopyIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="9" y="9" width="12" height="12" rx="2" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M5 15 H4 a1 1 0 0 1 -1 -1 V4 a1 1 0 0 1 1 -1 h10 a1 1 0 0 1 1 1 v1" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
CopyIcon.displayName = 'CopyIcon';

export const ShareIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M4 12 v7 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-7" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M16 6 L12 2 L8 6" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M12 2 v13" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
ShareIcon.displayName = 'ShareIcon';

export const CloseIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M6 6 L18 18 M18 6 L6 18" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
CloseIcon.displayName = 'CloseIcon';

export const InfoIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M12 11 v6 M12 8 v0.1" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
InfoIcon.displayName = 'InfoIcon';

export const CrownIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 8 L7 14 L12 6 L17 14 L21 8 L19 18 H5 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="3" cy="8" r="1.2" fill={finalColor} />
    <circle cx="21" cy="8" r="1.2" fill={finalColor} />
    <circle cx="12" cy="6" r="1.2" fill={finalColor} />
  </svg>
  );
  }
);
CrownIcon.displayName = 'CrownIcon';

export const CoinIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="12" r="6" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M12 7.5 v1 M9 9.5 q0 -1.2 1.5 -1.2 h1.5 q1.5 0 1.5 1.2 v0.5 q0 0.8 -1 1.2 l-1.5 0.6 q-1 0.4 -1 1.2 v0.5 q0 1.2 1.5 1.2 h1.5 q1.5 0 1.5 -1.2 M9 15.5 v1 M12 8 v0.5 M12 14 v0.5" stroke={finalColor} strokeWidth="1.2" fill="none" strokeLinecap="round" />
  </svg>
  );
  }
);
CoinIcon.displayName = 'CoinIcon';

export const TrophyIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M8 4 h8 v6 a4 4 0 0 1 -8 0 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M16 5 h3 a2 2 0 0 1 0 4 h-3 M8 5 h-3 a2 2 0 0 0 0 4 h3" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M9 14 h6 l-1 4 h-4 z" fill={finalColor} />
    <rect x="8" y="18" width="8" height="2" rx="1" fill={finalColor} />
  </svg>
  );
  }
);
TrophyIcon.displayName = 'TrophyIcon';

export const UserIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="8" r="4" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M4 21 a8 8 0 0 1 16 0" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
UserIcon.displayName = 'UserIcon';

export const HouseIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 12 L12 3 L21 12 v8 a1 1 0 0 1 -1 1 h-5 v-7 h-4 v7 H4 a1 1 0 0 1 -1 -1 z" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
HouseIcon.displayName = 'HouseIcon';

export const DoorIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M5 21 V5 a2 2 0 0 1 2 -2 h7 a2 2 0 0 1 2 2 v16" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M5 21 h14 M16 12 h0.5" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M3 21 h18" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
DoorIcon.displayName = 'DoorIcon';

export const CartIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 4 h2 l2 12 h11 l2 -8 H6" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="9" cy="20" r="1.4" fill={finalColor} />
    <circle cx="17" cy="20" r="1.4" fill={finalColor} />
  </svg>
  );
  }
);
CartIcon.displayName = 'CartIcon';

export const GamepadIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="2" y="7" width="20" height="12" rx="3" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M7 13 h3 M8.5 11.5 v3" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="16" cy="12" r="0.8" fill={finalColor} />
    <circle cx="18" cy="14" r="0.8" fill={finalColor} />
  </svg>
  );
  }
);
GamepadIcon.displayName = 'GamepadIcon';

export const BoltIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M13 2 L4 14 h7 l-2 8 l10 -12 h-7 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
BoltIcon.displayName = 'BoltIcon';

export const RankIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="14" width="4" height="7" rx="0.5" fill={finalColor} />
    <rect x="9" y="9" width="4" height="12" rx="0.5" fill={finalColor} />
    <rect x="15" y="5" width="4" height="16" rx="0.5" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
RankIcon.displayName = 'RankIcon';

export const FlameIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 22 c-4 0 -7 -3 -7 -7 c0 -3 2 -5 3 -7 c0 1 1 2 2 2 c0 -3 2 -5 4 -7 c0 4 2 4 3 7 c2 2 2 4 2 5 c0 4 -3 7 -7 7 z"
      fill={finalColor} stroke={goldColor} strokeWidth={strokeWidth} />
    <path d="M12 18 c-1.5 0 -2.5 -1 -2.5 -2.5 c0 -1 1 -1.5 1.5 -2.5 c0 1 1 1 1.5 1.5 c0.5 -1 1 -1.5 1 -2.5 c1 1 1.5 2 1.5 3.5 c0 1.5 -1 2.5 -3 2.5 z"
      fill={goldColor} />
  </svg>
  );
  }
);
FlameIcon.displayName = 'FlameIcon';

export const RefreshIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 12 a9 9 0 0 1 15 -6.7 L21 8 M21 4 v4 h-4" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M21 12 a9 9 0 0 1 -15 6.7 L3 16 M3 20 v-4 h4" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
RefreshIcon.displayName = 'RefreshIcon';




// === 商城/资源类 ===
export const GiftIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="9" width="18" height="12" rx="1.5" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 13 h18" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 9 v12" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 9 c-2 0 -3 -1 -3 -3 a2 2 0 0 1 3 -1.5 a2 2 0 0 1 3 1.5 c0 2 -1 3 -3 3 z" fill={finalColor} />
  </svg>
  );
  }
);
GiftIcon.displayName = 'GiftIcon';

export const DiamondGemIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M6 4 h12 l3 5 l-9 11 l-9 -11 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M6 9 h12 M9 4 l3 5 l3 -5" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
DiamondGemIcon.displayName = 'DiamondGemIcon';

export const VipIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="6" width="18" height="13" rx="2" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    {/* 卡面是金色底，"VIP" 三个字必须用深色，否则跟着 finalColor 变浅色就糊在金底上了 */}
    <text x="12" y="15.5" textAnchor="middle" fontSize="8" fontWeight="900" fill="#2E0F5C" fontFamily="sans-serif" letterSpacing="0.5">VIP</text>
    <circle cx="6" cy="4" r="1.2" fill={finalColor} />
    <circle cx="18" cy="4" r="1.2" fill={finalColor} />
    <path d="M6 5 v-1 a2 2 0 0 1 4 0 v1" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M14 5 v-1 a2 2 0 0 1 4 0 v1" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
VipIcon.displayName = 'VipIcon';

/**
 * 房卡图标（门票形）。
 *
 * 用“中间带凹口的票”而不是直接拿 CardBackIcon：
 * 商城里「牌背」和「房卡」是两个相邻类目，图标一模一样会让人点错。
 */
export const TicketIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path
      d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4V7.5Z"
      fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth}
    />
    <path d="M12 9v1.5M12 13.5V15" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
TicketIcon.displayName = 'TicketIcon';

export const CardBackIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="4" y="3" width="16" height="18" rx="2" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M7 7 h10 M7 10 h10 M7 13 h10 M7 16 h10" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="12" cy="11.5" r="1.5" fill={finalColor} />
  </svg>
  );
  }
);
CardBackIcon.displayName = 'CardBackIcon';

export const PlusIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw + 0.4, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 5 v14 M5 12 h14" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
PlusIcon.displayName = 'PlusIcon';

export const CheckIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw + 0.4, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M5 12 l5 5 l9 -10" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
CheckIcon.displayName = 'CheckIcon';

export const ChevronRightIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw + 0.2, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M9 5 l7 7 l-7 7" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
ChevronRightIcon.displayName = 'ChevronRightIcon';

export const SearchIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="11" cy="11" r="7" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M16 16 l5 5" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
SearchIcon.displayName = 'SearchIcon';

export const FilterIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 5 h18 M6 12 h12 M9 19 h6" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
FilterIcon.displayName = 'FilterIcon';

export const ChatIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M4 5 h16 a1 1 0 0 1 1 1 v10 a1 1 0 0 1 -1 1 h-9 l-5 4 v-4 h-2 a1 1 0 0 1 -1 -1 v-10 a1 1 0 0 1 1 -1 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="8" cy="11" r="1" fill={finalColor} />
    <circle cx="12" cy="11" r="1" fill={finalColor} />
    <circle cx="16" cy="11" r="1" fill={finalColor} />
  </svg>
  );
  }
);
ChatIcon.displayName = 'ChatIcon';

export const SmileIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="9" cy="10" r="1.2" fill={finalColor} />
    <circle cx="15" cy="10" r="1.2" fill={finalColor} />
    <path d="M8 14 a4 4 0 0 0 8 0" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
SmileIcon.displayName = 'SmileIcon';

export const SendIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 12 L21 4 L13 21 L11 13 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
SendIcon.displayName = 'SendIcon';
// Icon / IconName / Icons 已移到 ./iconMap.tsx（依赖图标映射表）

// === 战绩/数据类 (v3 战绩页专用) ===
export const CalendarIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="5" width="18" height="16" rx="2" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 10 h18" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 3 v4 M16 3 v4" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <rect x="7" y="13" width="3" height="3" rx="0.5" fill={finalColor} />
    <rect x="12" y="13" width="3" height="3" rx="0.5" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
CalendarIcon.displayName = 'CalendarIcon';

export const LineChartIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw + 0.2, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 20 a1 1 0 0 1 -1 -1 V5 a1 1 0 0 1 1 -1 h18 a1 1 0 0 1 1 1 v14 a1 1 0 0 1 -1 1 z" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M6 16 L10 11 L13 14 L18 8" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="6" cy="16" r="1.2" fill={finalColor} />
    <circle cx="10" cy="11" r="1.2" fill={finalColor} />
    <circle cx="13" cy="14" r="1.2" fill={finalColor} />
    <circle cx="18" cy="8" r="1.4" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
LineChartIcon.displayName = 'LineChartIcon';

export const BarChartIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 20 a1 1 0 0 1 -1 -1 V5 a1 1 0 0 1 1 -1 h18 a1 1 0 0 1 1 1 v14 a1 1 0 0 1 -1 1 z" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <rect x="6" y="13" width="3" height="5" rx="0.5" fill={finalColor} />
    <rect x="11" y="9" width="3" height="9" rx="0.5" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <rect x="16" y="6" width="3" height="12" rx="0.5" fill={finalColor} />
  </svg>
  );
  }
);
BarChartIcon.displayName = 'BarChartIcon';

export const PieChartIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 3 a9 9 0 0 1 9 9 h-9 z" fill={finalColor} />
    <circle cx="12" cy="12" r="3" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
PieChartIcon.displayName = 'PieChartIcon';

export const ArrowUpIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw + 0.2, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 19 V5 M5 12 L12 5 L19 12" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
ArrowUpIcon.displayName = 'ArrowUpIcon';

export const ArrowDownIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw + 0.2, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 5 V19 M5 12 L12 19 L19 12" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
ArrowDownIcon.displayName = 'ArrowDownIcon';

export const WinHandIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M7 12 L4 9 V4 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 z" fill={finalColor} />
    <path d="M17 12 L20 9 V4 a1 1 0 0 0 -1 -1 h-2 a1 1 0 0 0 -1 1 z" fill={finalColor} />
    <path d="M3 12 c0 -1 1 -2 2 -2 h14 c1 0 2 1 2 2 v6 a3 3 0 0 1 -3 3 H6 a3 3 0 0 1 -3 -3 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 17 L10 15 L11 16 L12 14 L13 16 L14 15 L15 17" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
WinHandIcon.displayName = 'WinHandIcon';

export const HistoryIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 12 a9 9 0 1 0 3.2 -6.9 L3 8 M3 4 v4 h4" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M12 7 v5 l3 2" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <circle cx="12" cy="12" r="1" fill={goldColor} />
  </svg>
  );
  }
);
HistoryIcon.displayName = 'HistoryIcon';

export const TrendUpIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 17 L9 11 L13 15 L21 7" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M15 7 L21 7 L21 13" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M3 21 h18" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
TrendUpIcon.displayName = 'TrendUpIcon';

export const TrendDownIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 7 L9 13 L13 9 L21 17" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M15 17 L21 17 L21 11" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M3 21 h18" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
TrendDownIcon.displayName = 'TrendDownIcon';

export const SparkIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 2 L13.5 9 L21 10.5 L13.5 12 L12 19 L10.5 12 L3 10.5 L10.5 9 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M19 4 L19.7 6.3 L22 7 L19.7 7.7 L19 10 L18.3 7.7 L16 7 L18.3 6.3 z" fill={finalColor} />
  </svg>
  );
  }
);
SparkIcon.displayName = 'SparkIcon';

export const TargetIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="12" r="5" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="12" r="1.5" fill={finalColor} />
  </svg>
  );
  }
);
TargetIcon.displayName = 'TargetIcon';

export const StarIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 3 L14.5 9 L21 9.5 L16 14 L17.5 21 L12 17.5 L6.5 21 L8 14 L3 9.5 L9.5 9 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
StarIcon.displayName = 'StarIcon';

export const FlagIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M5 21 V4" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M5 4 H17 L14 8 L17 12 H5 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
FlagIcon.displayName = 'FlagIcon';

export const DigIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 18 L21 18" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M5 18 L8 8 a4 4 0 0 1 8 0 L19 18" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 5 L14 5" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
DigIcon.displayName = 'DigIcon';



// === 匹配/连接类 ===
export const RadarIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="12" r="5" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 2 v3 M12 19 v3 M2 12 h3 M19 12 h3" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="12" r="1.5" fill={finalColor} />
    <path d="M5 5 L8 8 M16 16 L19 19" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
RadarIcon.displayName = 'RadarIcon';

export const PulseIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw + 0.2, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M2 12 H6 L8 6 L11 18 L14 9 L16 12 H22" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="12" cy="12" r="2" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
PulseIcon.displayName = 'PulseIcon';

export const WifiIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M2 8 a16 16 0 0 1 20 0" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M5 12 a11 11 0 0 1 14 0" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M8 16 a6 6 0 0 1 8 0" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="12" cy="20" r="1.5" fill={finalColor} />
  </svg>
  );
  }
);
WifiIcon.displayName = 'WifiIcon';

export const HourglassIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M6 3 H18 M6 21 H18 M7 3 V8 a5 5 0 0 0 10 0 V3 M7 21 V16 a5 5 0 0 1 10 0 V21" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 12 a3 3 0 0 0 6 0 a3 3 0 0 0 -6 0" fill={finalColor} fillOpacity="0.4" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
HourglassIcon.displayName = 'HourglassIcon';

export const LightningIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M13 2 L4 14 h6 l-2 8 l10 -12 h-6 z" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
LightningIcon.displayName = 'LightningIcon';

export const MuteIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 9 v6 h4 l5 4 V5 l-5 4 z" fill={finalColor} />
    <path d="M16 9 l5 6 M21 9 l-5 6" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
MuteIcon.displayName = 'MuteIcon';


// === 登录/认证类 ===
export const PhoneIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="6" y="2" width="12" height="20" rx="2.5" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <rect x="9" y="4" width="6" height="1.5" rx="0.5" fill={finalColor} fillOpacity="0.6" />
    <circle cx="12" cy="19" r="1" fill={finalColor} />
    <path d="M10 8 h4 M10 11 h4 M10 14 h2" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
PhoneIcon.displayName = 'PhoneIcon';

export const LockIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="4" y="10" width="16" height="11" rx="2" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M7 10 V7 a5 5 0 0 1 10 0 v3" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="15" r="1.5" fill={finalColor} />
    <path d="M12 16 v3" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
LockIcon.displayName = 'LockIcon';

export const EyeIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M2 12 c3 -5 7 -7 10 -7 s7 2 10 7 c-3 5 -7 7 -10 7 s-7 -2 -10 -7 z" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="12" r="3" fill={finalColor} />
  </svg>
  );
  }
);
EyeIcon.displayName = 'EyeIcon';

export const EyeOffIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 4 L21 20" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M9 5 a9 9 0 0 1 11 4 M5 8 a11 11 0 0 0 -3 4 c1.5 2.5 3.5 4.5 6 5.5" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 9 a4 4 0 0 0 5 5 M15 9.5 a4 4 0 0 0 -5 5" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M14 14 c2 1 4 2 5 3 M9 11 a14 14 0 0 0 -2 -1" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
EyeOffIcon.displayName = 'EyeOffIcon';

export const ShieldIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 2 L4 5 v7 c0 5 3 8 8 10 c5 -2 8 -5 8 -10 V5 z" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 12 l2 2 l4 -5" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
ShieldIcon.displayName = 'ShieldIcon';

export const WechatIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <ellipse cx="9" cy="10" rx="6" ry="5" fill={goldColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <ellipse cx="15" cy="14" rx="5" ry="4" fill={finalColor} fillOpacity="0.85" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="7" cy="9" r="0.8" fill={finalColor} />
    <circle cx="11" cy="9" r="0.8" fill={finalColor} />
    <circle cx="14" cy="14" r="0.7" fill="#FAF8F2" />
    <circle cx="17" cy="14" r="0.7" fill="#FAF8F2" />
  </svg>
  );
  }
);
WechatIcon.displayName = 'WechatIcon';

export const AppleIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M16 4 c-1 0 -2 1 -3 2 c-1 -1 -2 -2 -3 -2 c-2 0 -4 2 -4 5 c0 4 3 9 5 9 c1 0 1 -1 2 -1 s1 1 2 1 c2 0 5 -5 5 -9 c0 -1 -1 -2 -2 -2 c-1 0 -2 1 -2 2" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M13 4 c0 -1 1 -2 2 -2" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
AppleIcon.displayName = 'AppleIcon';

export const GuestIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="8" r="4" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M4 21 a8 8 0 0 1 16 0" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 8 h6 M12 5 v6" stroke={finalColor} strokeWidth={strokeWidth - 0.2} fill="none" />
  </svg>
  );
  }
);
GuestIcon.displayName = 'GuestIcon';

export const UserCircleIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="10" fill={goldColor} fillOpacity="0.15" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="9" r="3.5" fill={finalColor} />
    <path d="M5 19 a7 7 0 0 1 14 0" fill={finalColor} fillOpacity="0.7" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
UserCircleIcon.displayName = 'UserCircleIcon';

export const KeyIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="7" cy="15" r="3" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 15 L21 4 M18 7 l2 2 M15 10 l2 2" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
KeyIcon.displayName = 'KeyIcon';

export const VerifyCodeIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="6" width="18" height="12" rx="2" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 10 h18" stroke={finalColor} strokeWidth={strokeWidth} />
    <text x="12" y="16" textAnchor="middle" fontSize="6" fontWeight="900" fill={finalColor} fontFamily="monospace" letterSpacing="0.5">1234</text>
  </svg>
  );
  }
);
VerifyCodeIcon.displayName = 'VerifyCodeIcon';


// === 通知/推送类 ===
export const BellIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M6 16 V11 a6 6 0 0 1 12 0 v5 l1.5 2 H4.5 z" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 20 a2 2 0 0 0 4 0" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="18" cy="6" r="3" fill={finalColor} />
    <circle cx="18" cy="6" r="2" fill="#E8D3A8" />
  </svg>
  );
  }
);
BellIcon.displayName = 'BellIcon';

export const BellOffIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 4 L21 20" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M6 16 V11 a6 6 0 0 1 9 -5" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M6 16 l-1.5 2 H15 M18 13 V11 a6 6 0 0 0 -1 -3" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 20 a2 2 0 0 0 4 0" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
BellOffIcon.displayName = 'BellOffIcon';

export const MegaphoneIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 9 v6 a1 1 0 0 0 1 1 h2 l11 5 V3 L6 8 H4 a1 1 0 0 0 -1 1 z" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M19 8 a3 3 0 0 1 0 8" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 16 v3 a1 1 0 0 0 2 0 v-2" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
MegaphoneIcon.displayName = 'MegaphoneIcon';

export const PinIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 2 v8 M9 7 h6" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M9 10 L6 13 h12 L15 10" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 13 v9" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
PinIcon.displayName = 'PinIcon';

export const TrendingIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 17 L9 11 L13 15 L21 7" fill="none" stroke={finalColor} strokeWidth={strokeWidth + 0.2} />
    <path d="M15 7 L21 7 L21 13" fill="none" stroke={finalColor} strokeWidth={strokeWidth + 0.2} />
  </svg>
  );
  }
);
TrendingIcon.displayName = 'TrendingIcon';

export const TrashIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 6 h18 M8 6 V4 a1 1 0 0 1 1 -1 h6 a1 1 0 0 1 1 1 v2 M5 6 l1 14 a1 1 0 0 0 1 1 h10 a1 1 0 0 0 1 -1 l1 -14" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M10 11 v6 M14 11 v6" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
TrashIcon.displayName = 'TrashIcon';

export const CheckAllIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw + 0.4, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M2 12 l4 4 l6 -8" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M9 12 l4 4 l9 -12" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
  </svg>
  );
  }
);
CheckAllIcon.displayName = 'CheckAllIcon';

export const MailIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="5" width="18" height="14" rx="2" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 7 L12 13 L21 7" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
MailIcon.displayName = 'MailIcon';

export const MailOpenIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 7 L12 13 L21 7" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 7 V18 a1 1 0 0 0 1 1 h16 a1 1 0 0 0 1 -1 V7" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 7 L12 2 L21 7" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
MailOpenIcon.displayName = 'MailOpenIcon';

export const DoNotDisturbIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="9" r="1.2" fill={finalColor} />
    <path d="M9 13 h6" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M12 13 v5" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
DoNotDisturbIcon.displayName = 'DoNotDisturbIcon';


// === 反馈/客服类 ===
export const QuestionIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 9 a3 3 0 0 1 6 0 c0 2 -3 2 -3 4" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="16" r="0.8" fill={finalColor} />
  </svg>
  );
  }
);
QuestionIcon.displayName = 'QuestionIcon';

export const BugIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <ellipse cx="12" cy="13" rx="4" ry="5" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 8 v-3 M9 5 l3 3 l3 -3" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M6 10 l3 2 M18 10 l-3 2 M5 13 h3 M16 13 h3 M6 17 l3 -1 M18 17 l-3 -1" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M9 13 v3 a3 3 0 0 0 6 0 v-3" fill={finalColor} fillOpacity="0.4" />
  </svg>
  );
  }
);
BugIcon.displayName = 'BugIcon';

export const LightbulbIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M9 18 h6 M10 21 h4" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <path d="M8 14 a5 5 0 1 1 8 0 c-1 1 -1 2 -1 3 h-6 c0 -1 0 -2 -1 -3 z" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M11 12 L12 9 L13 12" stroke={finalColor} strokeWidth={strokeWidth - 0.2} fill="none" />
  </svg>
  );
  }
);
LightbulbIcon.displayName = 'LightbulbIcon';

export const ImageIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="4" width="18" height="16" rx="2" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="9" cy="10" r="1.5" fill={finalColor} />
    <path d="M3 16 L9 12 L14 17 L17 14 L21 18" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
ImageIcon.displayName = 'ImageIcon';

export const AttachIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M16 6 L9 13 a4 4 0 0 0 5.5 5.5 L21 12 a7 7 0 0 0 -10 -10 L4 9 a3 3 0 0 0 4 4 L17 4" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
AttachIcon.displayName = 'AttachIcon';

export const GroupIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="9" cy="9" r="3" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="17" cy="10" r="2.5" fill={finalColor} fillOpacity="0.6" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 19 a6 6 0 0 1 12 0" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M15 19 a4 4 0 0 1 6 0" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
GroupIcon.displayName = 'GroupIcon';

export const ThumbUpIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M7 11 V20 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 V11 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 z" fill={finalColor} />
    <path d="M7 11 L11 4 a2 2 0 0 1 2 2 v3 h4 a2 2 0 0 1 2 2.5 l-1 6 a2 2 0 0 1 -2 1.5 H7" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
ThumbUpIcon.displayName = 'ThumbUpIcon';

export const ThumbDownIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M17 13 V4 a1 1 0 0 1 1 -1 h2 a1 1 0 0 1 1 1 v9 a1 1 0 0 1 -1 1 h-2 a1 1 0 0 1 -1 -1 z" fill={finalColor} />
    <path d="M17 13 L13 20 a2 2 0 0 1 -2 -2 v-3 H7 a2 2 0 0 1 -2 -2.5 l1 -6 a2 2 0 0 1 2 -1.5 h9" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
ThumbDownIcon.displayName = 'ThumbDownIcon';

export const ForwardIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M5 12 h12 M13 6 L19 12 L13 18" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
ForwardIcon.displayName = 'ForwardIcon';

export const WarningIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 3 L22 20 H2 z" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 9 v5" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <circle cx="12" cy="17" r="0.8" fill={finalColor} />
  </svg>
  );
  }
);
WarningIcon.displayName = 'WarningIcon';

// === 支付/交易类 ===
export const WalletIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" fill={goldColor} fillOpacity="0.18" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 9 h15 a2 2 0 0 1 2 2 v0 a2 2 0 0 1 -2 2 h-2 a2 2 0 1 1 0 -4 h4" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="16" cy="13" r="1.1" fill={finalColor} />
    <path d="M6 6 v-1 a2 2 0 0 1 2 -2 h7 a2 2 0 0 1 2 2 v1" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
WalletIcon.displayName = 'WalletIcon';

export const QrCodeIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth: _strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="3" width="7" height="7" rx="1" fill={finalColor} />
    <rect x="5" y="5" width="3" height="3" fill={goldColor} />
    <rect x="14" y="3" width="7" height="7" rx="1" fill={finalColor} />
    <rect x="16" y="5" width="3" height="3" fill={goldColor} />
    <rect x="3" y="14" width="7" height="7" rx="1" fill={finalColor} />
    <rect x="5" y="16" width="3" height="3" fill={goldColor} />
    <rect x="14" y="14" width="2.5" height="2.5" fill={finalColor} />
    <rect x="17.5" y="14" width="2.5" height="2.5" fill={finalColor} />
    <rect x="14" y="17.5" width="2.5" height="2.5" fill={finalColor} />
    <rect x="18.5" y="18.5" width="2.5" height="2.5" fill={finalColor} />
  </svg>
  );
  }
);
QrCodeIcon.displayName = 'QrCodeIcon';

// 支付宝风格（蓝底 + 「支」字抽象笔划）
export const AlipayIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#1677FF" fillOpacity="0.9" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M5 9 q3 -2 6 0 q3 2 7 0" fill="none" stroke={goldColor} strokeWidth={strokeWidth + 0.4} />
    <path d="M7 14 q5 4 11 -2" fill="none" stroke={goldColor} strokeWidth={strokeWidth + 0.3} />
    <circle cx="9" cy="11" r="0.8" fill={goldColor} />
    <circle cx="15" cy="11" r="0.8" fill={goldColor} />
  </svg>
  );
  }
);
AlipayIcon.displayName = 'AlipayIcon';

// 微信支付风格（绿底 + 聊天气泡抽象）
export const WechatPayIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#09BB07" fillOpacity="0.85" stroke={finalColor} strokeWidth={strokeWidth} />
    <ellipse cx="9" cy="11" rx="5" ry="4" fill={goldColor} fillOpacity="0.95" />
    <ellipse cx="16" cy="13" rx="4" ry="3.2" fill={goldColor} fillOpacity="0.95" />
    <circle cx="7.5" cy="10.5" r="0.7" fill="#09BB07" />
    <circle cx="10.5" cy="10.5" r="0.7" fill="#09BB07" />
    <circle cx="14.5" cy="12.5" r="0.6" fill="#09BB07" />
    <circle cx="17" cy="12.5" r="0.6" fill="#09BB07" />
  </svg>
  );
  }
);
WechatPayIcon.displayName = 'WechatPayIcon';

// 银联风格（红底 + 银横条）
export const UnionPayIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="linear-gradient(#C8312B, #A93226)" fillOpacity="0.95" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M3 8 h18 M3 16 h18" stroke={goldColor} strokeWidth={strokeWidth + 0.4} />
    <text x="12" y="14.5" textAnchor="middle" fontSize="6.5" fontWeight="800" fill={goldColor} fontFamily="sans-serif">银联</text>
  </svg>
  );
  }
);
UnionPayIcon.displayName = 'UnionPayIcon';

// QQ 钱包（蓝紫企鹅抽象）
export const QqPayIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#1296DB" fillOpacity="0.92" stroke={finalColor} strokeWidth={strokeWidth} />
    <ellipse cx="12" cy="13" rx="6.5" ry="5.5" fill={goldColor} fillOpacity="0.95" />
    <circle cx="9.5" cy="11.5" r="1" fill="#1296DB" />
    <circle cx="14.5" cy="11.5" r="1" fill="#1296DB" />
    <path d="M9.5 15 q2.5 2 5 0" fill="none" stroke="#1296DB" strokeWidth={strokeWidth + 0.2} />
    <path d="M9 7.5 a3 3 0 0 1 6 0" fill={goldColor} fillOpacity="0.8" />
  </svg>
  );
  }
);
QqPayIcon.displayName = 'QqPayIcon';

// Apple Pay 风格（黑底 + apple + Pay）
export const ApplePayIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#0A0A0A" fillOpacity="0.95" stroke={finalColor} strokeWidth={strokeWidth} />
    {/* 苹果图形缩小上移，给下面的 "Pay" 让出纯黑区域。
        原来 Pay 直接压在金色苹果上（金字压金底，对比只有 1.09），根本看不清。 */}
    <g transform="translate(4.6 -0.6) scale(0.62)">
      <path d="M13 6.5 a1.5 1.5 0 0 1 1.5 1.5 c0 1 -1 1.5 -1.5 1.5 c-0.5 0 -1 -0.5 -1.5 -0.5 c-0.5 0 -1 0.5 -1.5 0.5 c-1 0 -1.5 -1 -1.5 -2 a3 3 0 0 1 3 -3 c0.5 0 1 0.5 1.5 0.5 c0.5 0 1 -0.5 1 -0.5 z" fill={goldColor} fillOpacity="0.95" />
      <path d="M15 11 c-1.5 0 -2.5 1 -3.5 1 c-1 0 -2 -1 -3 -1 c-2 0 -4 2 -4 5 c0 3 2 6 3.5 6 c1 0 1.5 -0.7 2.5 -0.7 c1 0 1.5 0.7 2.5 0.7 c1.5 0 3.5 -3 3.5 -6 c0 -2.5 -1.5 -4 -3.5 -4 z" fill={goldColor} fillOpacity="0.95" />
    </g>
    <text x="12" y="20" textAnchor="middle" fontSize="5" fontWeight="800" fill={goldColor} fontFamily="sans-serif">Pay</text>
  </svg>
  );
  }
);
ApplePayIcon.displayName = 'ApplePayIcon';

// 余额支付（金币 + 钱包）
export const BalanceIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.25" stroke={finalColor} strokeWidth={strokeWidth} />
    <text x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="900" fill={finalColor} fontFamily="serif">¥</text>
  </svg>
  );
  }
);
BalanceIcon.displayName = 'BalanceIcon';

// 加载/旋转
export const SpinnerIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw + 0.6, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill="none" stroke={finalColor} strokeOpacity="0.25" strokeWidth={strokeWidth} />
    <path d="M21 12 a9 9 0 0 0 -9 -9" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
SpinnerIcon.displayName = 'SpinnerIcon';

// 指纹
export const FingerprintIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M5 13 a7 7 0 0 1 14 0" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 14 a4 4 0 0 1 8 0 c0 1.5 -0.3 3 -1 4" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M11 15 a1.5 1.5 0 0 1 2 0 c0 1.2 -0.4 2.2 -1 3" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M6 11 c0 -3 2.5 -5 6 -5 c3.5 0 6 2 6 5 c0 1.5 -0.2 3 -0.5 4" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
FingerprintIcon.displayName = 'FingerprintIcon';

// 支付成功（圆 + 对勾光圈）
export const PaySuccessIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw + 0.4, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="10" fill={finalColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M7 12 L11 16 L17 9" fill="none" stroke={finalColor} strokeWidth={strokeWidth + 0.6} />
  </svg>
  );
  }
);
PaySuccessIcon.displayName = 'PaySuccessIcon';

// 支付失败
export const PayFailedIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw + 0.4, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="10" fill={finalColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 8 L16 16 M16 8 L8 16" fill="none" stroke={finalColor} strokeWidth={strokeWidth + 0.4} />
  </svg>
  );
  }
);
PayFailedIcon.displayName = 'PayFailedIcon';

// 礼物爆炸（成功页装饰）
export const GiftBoomIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="8" y="11" width="8" height="9" rx="1.2" fill={goldColor} fillOpacity="0.5" stroke={finalColor} strokeWidth={strokeWidth} />
    <rect x="6" y="8" width="12" height="4" rx="0.8" fill={finalColor} fillOpacity="0.7" />
    <path d="M12 8 v-3 M12 5 q-2 -2 -3 0 q0 1.5 3 3 q3 -1.5 3 -3 q-1 -2 -3 0" fill={finalColor} fillOpacity="0.85" stroke={finalColor} strokeWidth={strokeWidth - 0.2} />
    <path d="M4 4 L2 2 M20 4 L22 2 M12 2 V0 M5 8 L3 7 M19 8 L21 7" stroke={goldColor} strokeWidth={strokeWidth - 0.2} />
  </svg>
  );
  }
);
GiftBoomIcon.displayName = 'GiftBoomIcon';

// 红包（喜庆红 + 金元宝）
export const RedPacketIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="5" width="18" height="14" rx="2" fill="#A93226" fillOpacity="0.95" stroke={finalColor} strokeWidth={strokeWidth} />
    {/* 元宝放大并提到纯白亮金，福字压到近黑红，5px 才分得清 */}
    <ellipse cx="12" cy="12" rx="4.4" ry="3.2" fill="#FEF9C3" />
    <text x="12" y="14.1" textAnchor="middle" fontSize="5.5" fontWeight="900" fill="#5A0A0A" fontFamily="serif">福</text>
  </svg>
  );
  }
);
RedPacketIcon.displayName = 'RedPacketIcon';

// 订单/列表
export const OrderIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="4" y="3" width="16" height="18" rx="1.5" fill={goldColor} fillOpacity="0.18" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 8 h8 M8 12 h8 M8 16 h5" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
OrderIcon.displayName = 'OrderIcon';

// 客服（小头像 + 耳机）
export const HeadsetIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M4 14 v-2 a8 8 0 0 1 16 0 v2" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <rect x="3" y="13" width="4" height="6" rx="1.2" fill={finalColor} fillOpacity="0.7" stroke={finalColor} strokeWidth={strokeWidth} />
    <rect x="17" y="13" width="4" height="6" rx="1.2" fill={finalColor} fillOpacity="0.7" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M19 19 v1 a2 2 0 0 1 -2 2 h-2" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
  </svg>
  );
  }
);
HeadsetIcon.displayName = 'HeadsetIcon';

// === 下载 ===
export const DownloadIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M12 4 V15 M7 11 L12 16 L17 11" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M5 20 H19" stroke={finalColor} strokeWidth={strokeWidth + 0.2} />
  </svg>
  );
  }
);
DownloadIcon.displayName = 'DownloadIcon';


// === 倒计时（钟） ===
export const CountdownIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="13" r="8" fill={goldColor} fillOpacity="0.2" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 8.5 V13 L15.5 15" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
    <path d="M9 3 H15 M12 3 V5.5" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="12" cy="13" r="0.8" fill={finalColor} />
  </svg>
  );
  }
);
CountdownIcon.displayName = 'CountdownIcon';

// === 勋章（VIP 等级） ===
export const MedalIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M7 2 L9 8 M17 2 L15 8" stroke={finalColor} strokeWidth={strokeWidth} fill="none" />
    <circle cx="12" cy="14" r="7" fill={goldColor} fillOpacity="0.4" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M12 9 L13.5 12 L16.5 12.3 L14.3 14.4 L15 17.3 L12 15.8 L9 17.3 L9.7 14.4 L7.5 12.3 L10.5 12 z" fill={finalColor} stroke={finalColor} strokeWidth={strokeWidth - 0.2} />
  </svg>
  );
  }
);
MedalIcon.displayName = 'MedalIcon';

// === 折扣（标签） ===
export const DiscountIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M13 3 H4 V12 L13 21 L22 12 L13 3 z" fill={goldColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="8" cy="8" r="1.5" fill={finalColor} />
    <path d="M11 13 L17 7" stroke={finalColor} strokeWidth={strokeWidth + 0.2} fill="none" />
  </svg>
  );
  }
);
DiscountIcon.displayName = 'DiscountIcon';

// === 进度条（条形） ===
export const ProgressIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth: _strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="3" y="9" width="3" height="6" rx="0.5" fill={finalColor} fillOpacity="0.4" />
    <rect x="8" y="7" width="3" height="10" rx="0.5" fill={finalColor} fillOpacity="0.6" />
    <rect x="13" y="4" width="3" height="16" rx="0.5" fill={finalColor} fillOpacity="0.85" />
    <rect x="18" y="2" width="3" height="20" rx="0.5" fill={finalColor} />
  </svg>
  );
  }
);
ProgressIcon.displayName = 'ProgressIcon';

// === 对勾环（成就解锁） ===
export const UnlockIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="12" r="9" fill={goldColor} fillOpacity="0.25" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 12 L11 15 L16 9" fill="none" stroke={finalColor} strokeWidth={strokeWidth + 0.4} />
  </svg>
  );
  }
);
UnlockIcon.displayName = 'UnlockIcon';

// === 锁定 ===
export const LockedIcon = forwardRef<SVGSVGElement, IconProps>(({ size, className, color, tone, goldColor: _goldColor = '#E8D3A8', strokeWidth = sw, ...rest }, ref) => { const finalColor = resolveColor(color, tone); return (
  <svg ref={ref} {...baseProps(size)} className={className} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect x="5" y="11" width="14" height="10" rx="1.5" fill={finalColor} fillOpacity="0.3" stroke={finalColor} strokeWidth={strokeWidth} />
    <path d="M8 11 V8 a4 4 0 0 1 8 0 v3" fill="none" stroke={finalColor} strokeWidth={strokeWidth} />
    <circle cx="12" cy="16" r="1.2" fill={finalColor} />
  </svg>
  );
  }
);
LockedIcon.displayName = 'LockedIcon';

// Icons 映射已移到 ./iconMap.ts（非组件导出会破坏 react-refresh）
