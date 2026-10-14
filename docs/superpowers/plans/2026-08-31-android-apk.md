# Android APK App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the production web game as an Android APK that launches full screen, stays landscape, and uses the Android system share sheet through the WeChat entry.

**Architecture:** Add Capacitor at the repository root as a thin native Android shell. The app loads `https://tianwang.geju8.cn/` directly, so web releases remain live without rebuilding the APK. Native Android manifest/style/activity settings enforce landscape and immersive full screen; the web share utility prefers the injected Capacitor Share plugin when it exists.

**Tech Stack:** Capacitor 7, Android SDK, Gradle, React/Vite production build, existing Node tests.

**Spec:** Approved conversation: “安卓直接安装 APK，先解决全屏、横屏、微信分享”。

## Global Constraints

- Production URL: `https://tianwang.geju8.cn/`
- App display name: `天王扑克`
- Android app id: `cn.geju8.tianwang`
- Orientation: `sensorLandscape`
- App mode must suppress the existing “添加到主屏幕” PWA prompt.
- No secret values or keystore passwords are printed in chat or tool output.
- The delivered artifact must be an installable signed APK, not source only.

---

### Task 1: Native-aware share and app detection

**Files:**
- Modify: `client/src/utils/share.test.ts`
- Modify: `client/src/utils/share.ts`
- Modify: `client/src/components/InstallPrompt.tsx`

**Interfaces:**
- Produces: `isNativeApp(): boolean`
- Produces: `systemShare(input: SystemShareInput): Promise<SystemShareResult>` preferring Capacitor Share when available.

- [ ] Write failing tests for:
  1. Capacitor bridge share success maps to `shared`.
  2. Capacitor bridge cancellation maps to `cancelled`.
  3. Capacitor bridge failure maps to `failed`.
  4. `isNativeApp()` recognizes `window.Capacitor`.
- [ ] Run `npm test -- src/utils/share.test.ts` and confirm the new tests fail.
- [ ] Implement the Capacitor bridge path and native app detector.
- [ ] Use `isNativeApp()` in `detectPwaMode()` so the install prompt is hidden in the APK.
- [ ] Run the focused tests, then `npm run verify`.

### Task 2: Android shell

**Files:**
- Create: `capacitor.config.json`
- Create: `android/`
- Modify: root `package.json`, root `package-lock.json`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/values/styles.xml`
- Modify: `android/app/src/main/java/cn/geju8/tianwang/MainActivity.java`

**Interfaces:**
- Consumes: production URL and app identifiers above.
- Produces: `npm run android:build` release APK command.

- [ ] Install Capacitor dependencies at repository root.
- [ ] Initialize Capacitor with `webDir: client/dist`.
- [ ] Add Android platform and configure `server.url` to the production URL.
- [ ] Set Android label to `天王扑克`, orientation to `sensorLandscape`, and theme to no-action-bar.
- [] Add immersive system-bar hiding in `MainActivity.onWindowFocusChanged`.
- [ ] Build the web bundle and sync Android assets.
- [ ] Run a Gradle release build and sign it with a local, ignored keystore properties file.

### Task 3: Verification and delivery

**Files:**
- Create: `releases/` (ignored except metadata if needed)
- Modify: `.gitignore`

**Interfaces:**
- Produces: local APK at `releases/wuhuatianwang-android.apk`.

- [ ] Run full client verification.
- [ ] Build the release APK.
- [ ] Inspect APK metadata with `aapt` or `apkanalyzer` to confirm label, orientation, fullscreen theme, and permissions.
- [ ] Verify production health and the URL embedded in the APK.
- [ ] Copy the signed artifact to a stable release path.
- [ ] Commit source/configuration changes, not the APK or keystore.
