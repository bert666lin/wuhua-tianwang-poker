// ===== 按名字动态渲染图标 =====
// 映射表在 ./iconMap.ts（纯数据），本文件只导出组件，保证 react-refresh 生效。

import { Icons } from './iconMap';
import type { IconProps } from './index';

/** 图标名联合类型，供配置驱动的调用方约束取值。 */
export type IconName = keyof typeof Icons;

/** 按名字动态渲染图标。 */
export const Icon = ({ name, ...rest }: IconProps & { name: IconName }) => {
  const C = Icons[name];
  return <C {...rest} />;
};
