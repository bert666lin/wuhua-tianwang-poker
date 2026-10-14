# 脚本说明

## visual-regression.mjs

视觉回归工具：对所有关键页面做三端截图。

### 用法

```bash
# 生成基准快照
node scripts/visual-regression.mjs baseline shots/baseline

# 生成新快照（对比用）
node scripts/visual-regression.mjs current shots/current
```

### 配置

- `TEST_URL` 环境变量：指定被测地址，默认 `http://localhost:5180/`
- 在脚本顶部的 `VIEWPORTS` 和 `PAGES` 数组里可增减视口/页面

玩家端以 844×390、667×375 两档手机横屏为主要验收视口；桌面和手机竖屏用于兼容性检查。

### 输出

每个视口 × 页面组合一张 PNG，命名格式 `{viewport}_{page}.png`。
