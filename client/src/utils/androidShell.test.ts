/**
 * 安卓壳（Capacitor）构建配置一致性测试。
 *
 * 为什么需要它：Capacitor 大版本升级要同时改好几处版本号
 * （package.json、variables.gradle、根 build.gradle 的 AGP、gradle wrapper），
 * 漏改一处的表现是**打包时才炸**，而打包不在日常 CI 里跑 —— 等到要发版
 * 才发现，往往是最赶时间的时候。
 *
 * 这里把「Capacitor 8 要求的版本下限」钉住，用纯文本读取，不需要 Android SDK
 * 也不需要 JDK，能跟普通单测一起跑。
 *
 * 官方要求的来源：node_modules/@capacitor/cli/assets/android-template.tar.gz
 * 里的 variables.gradle 与 build.gradle（Capacitor 8.5.0）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf-8');

const rootPkg = JSON.parse(read('package.json')) as {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const variables = read('android/variables.gradle');
const rootGradle = read('android/build.gradle');
const wrapper = read('android/gradle/wrapper/gradle-wrapper.properties');
const capConfig = JSON.parse(read('capacitor.config.json')) as {
  appId?: string;
  webDir?: string;
  server?: { url?: string; cleartext?: boolean };
};

/** 从 variables.gradle 取 `名字 = 数字`。 */
function gradleInt(name: string): number {
  const m = variables.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  assert.ok(m, `variables.gradle 里找不到 ${name}`);
  return Number(m[1]);
}

/** 取 major 版本号，'^8.5.0' -> 8。 */
function major(range: string): number {
  const m = range.match(/(\d+)/);
  assert.ok(m, `解析不出主版本号：${range}`);
  return Number(m[1]);
}

describe('Capacitor 包版本', () => {
  const CAP_PACKAGES = [
    '@capacitor/core',
    '@capacitor/cli',
    '@capacitor/android',
    '@capacitor/share',
  ];

  it('四个 Capacitor 包都装了', () => {
    for (const name of CAP_PACKAGES) {
      assert.ok(rootPkg.dependencies?.[name], `缺少依赖 ${name}`);
    }
  });

  /**
   * core / cli / android 必须同一个大版本。混版本（比如 core 8 + android 7）
   * 会在运行时才炸：壳里的 Java 侧和 JS 侧对不上，插件调用直接失败。
   */
  it('core / cli / android 三者大版本一致', () => {
    const majors = ['@capacitor/core', '@capacitor/cli', '@capacitor/android']
      .map(name => major(rootPkg.dependencies![name]));
    assert.equal(
      new Set(majors).size, 1,
      `Capacitor 主版本不一致：${JSON.stringify(majors)}`,
    );
  });

  it('已经升到 Capacitor 8 或更新（不能退回 7）', () => {
    assert.ok(
      major(rootPkg.dependencies!['@capacitor/core']) >= 8,
      'Capacitor 内核必须 >= 8',
    );
  });
});

describe('android/variables.gradle 满足 Capacitor 8 的硬要求', () => {
  /**
   * Capacitor 8 的 capacitor/build.gradle 里 compileSdk 默认 36。
   * 我们的项目通过 rootProject.ext 覆盖它，所以这里必须 >= 36，
   * 否则编译期报 "compileSdkVersion is not specified/too low"。
   */
  it('compileSdk / targetSdk >= 36', () => {
    assert.ok(gradleInt('compileSdkVersion') >= 36, 'compileSdk 必须 >= 36');
    assert.ok(gradleInt('targetSdkVersion') >= 36, 'targetSdk 必须 >= 36');
  });

  /**
   * minSdk 24 是 Capacitor 8 内核写死的下限，不是我们的选择。
   * 代价是放弃 Android 6.0（API 23）机型 —— 这条测试同时起到"备忘"作用：
   * 谁想把它压回 23 会先看到这段说明，而不是等编译报 manifest 冲突。
   */
  it('minSdk >= 24（Capacitor 8 的下限，意味着不再支持 Android 6.0）', () => {
    assert.ok(gradleInt('minSdkVersion') >= 24, 'Capacitor 8 要求 minSdk >= 24');
  });

  it('targetSdk 不低于 compileSdk（反了会有一堆行为差异告警）', () => {
    assert.ok(gradleInt('targetSdkVersion') <= gradleInt('compileSdkVersion'));
  });
});

describe('Gradle 与 AGP 版本', () => {
  /** Capacitor 8 模板用 AGP 8.13.0；低于它编译 SDK 36 会失败。 */
  it('AGP >= 8.13', () => {
    const m = rootGradle.match(/com\.android\.tools\.build:gradle:(\d+)\.(\d+)/);
    assert.ok(m, '根 build.gradle 里找不到 AGP 版本');
    const [maj, min] = [Number(m[1]), Number(m[2])];
    assert.ok(maj > 8 || (maj === 8 && min >= 13), `AGP ${m[1]}.${m[2]} 太旧，需要 >= 8.13`);
  });

  /** AGP 8.13 要求 Gradle >= 8.13；模板给的是 8.14.3。 */
  it('Gradle wrapper >= 8.13', () => {
    const m = wrapper.match(/gradle-(\d+)\.(\d+)(?:\.(\d+))?-/);
    assert.ok(m, 'gradle-wrapper.properties 里解析不出版本');
    const [maj, min] = [Number(m[1]), Number(m[2])];
    assert.ok(maj > 8 || (maj === 8 && min >= 13), `Gradle ${m[1]}.${m[2]} 太旧，AGP 8.13 需要 >= 8.13`);
  });

  it('用 -all 发行包（带源码，Android Studio 里能跳转 Gradle API）', () => {
    assert.match(wrapper, /gradle-[\d.]+-all\.zip/);
  });
});

describe('打包脚本与国内镜像（换机器/换网络也能打出包）', () => {
  it('保留阿里云镜像（直连 google() 在国内经常拉不动）', () => {
    assert.match(rootGradle, /maven\.aliyun\.com/, '阿里云镜像不能在升级时被模板覆盖掉');
  });

  it('阿里云镜像排在 google() 前面，否则等于没配', () => {
    const aliyun = rootGradle.indexOf('maven.aliyun.com');
    const google = rootGradle.indexOf('google()');
    assert.ok(aliyun >= 0 && google >= 0);
    assert.ok(aliyun < google, '镜像必须排在 google() 之前才会被优先命中');
  });

  it('保留 local-maven 兜底目录（离线也能打包）', () => {
    assert.match(rootGradle, /local-maven/);
  });
});

describe('capacitor.config.json', () => {
  it('appId 与安卓工程的 applicationId 一致（不一致会装成两个 app）', () => {
    const appGradle = read('android/app/build.gradle');
    const m = appGradle.match(/applicationId\s+"([^"]+)"/);
    assert.ok(m, '读不到 applicationId');
    assert.equal(capConfig.appId, m[1]);
  });

  it('namespace 也要跟 appId 一致', () => {
    const appGradle = read('android/app/build.gradle');
    const m = appGradle.match(/namespace\s+"([^"]+)"/);
    assert.ok(m, '读不到 namespace');
    assert.equal(capConfig.appId, m[1]);
  });

  /**
   * 壳直接加载线上站点（server.url），不是打包进去的静态文件。
   * 好处是改前端不用重新发 APK；前提是**必须 https 且禁明文**，
   * 否则运营商劫持能往牌桌里塞任意脚本。
   */
  it('线上地址必须是 https 且关掉明文传输', () => {
    assert.ok(capConfig.server?.url?.startsWith('https://'), '壳加载的地址必须是 https');
    assert.equal(capConfig.server?.cleartext, false, 'cleartext 必须为 false');
  });

  it('webDir 指向前端构建产物', () => {
    assert.equal(capConfig.webDir, 'client/dist');
  });
});

/**
 * ===== versionCode 自增 =====
 *
 * 这一组守的是一个真实事故点：versionCode 曾经写死成 1，
 * 于是每次重新打包出来的都还是"第 1 版"。Android 判断「是不是新版本」
 * 只看 versionCode，值没变就会拒装（提示「应用未安装」），
 * 用户只能先卸载 —— 卸载就丢本地登录态。
 *
 * 为什么要用测试钉住而不是"改完就算"：`npx cap sync android` 会用
 * Capacitor 官方模板刷新 android/ 目录，模板里的 build.gradle 就是
 * `versionCode 1`。一次不留神的 sync 就能把这个修复悄悄冲掉，
 * 而它的后果要等到发版给用户装的时候才暴露。
 */
describe('APK versionCode 必须随发版自增', () => {
  const appGradle = read('android/app/build.gradle');

  it('不能再出现写死的 versionCode 字面量', () => {
    // 允许 `versionCode appVersionCode`，不允许 `versionCode 1` 这类常量
    const hardcoded = appGradle.match(/^\s*versionCode\s+(\d+)\s*$/m);
    assert.equal(
      hardcoded,
      null,
      `versionCode 又被写死成 ${hardcoded?.[1]} 了（大概率是 npx cap sync 用官方模板覆盖回去了）。`
      + ' 值不变 = 用户装不上新版，必须改回从 git 提交数取。',
    );
    assert.match(appGradle, /versionCode\s+appVersionCode/, 'versionCode 必须取自 appVersionCode');
  });

  it('版本号取自 git 提交数（无需人工维护、且单调递增）', () => {
    assert.match(appGradle, /rev-list['"]\s*,\s*['"]--count/, '必须用 git rev-list --count HEAD 当版本号');
    assert.match(appGradle, /versionName\s+appVersionName/, 'versionName 也要跟着动');
    // versionName 带上数字，用户报障时说得出自己装的是哪一版
    assert.match(appGradle, /appVersionName\s*=\s*"1\.0\.\$\{appVersionCode\}"/,
      'versionName 应形如 1.0.<versionCode>');
  });

  it('拿不到 git 信息时必须让构建失败，绝不能退回 1', () => {
    /* 这条是整组里最关键的。
     * 如果读不到 git 就 `?: 1`，那这个 bug 会以最隐蔽的方式复活：
     * 构建照样成功、包也照样能发出去，只是用户装不上。
     * 宁可在打包机上炸掉，也不能发一个装不上的包。 */
    const throwCount = (appGradle.match(/throw new GradleException/g) ?? []).length;
    assert.ok(throwCount >= 2,
      `读不到 git / 浅克隆 两种情况都必须抛异常，当前只有 ${throwCount} 处 throw`);
    // 浅克隆的提交数是被截断的小数字，用它会让 versionCode 倒退
    assert.match(appGradle, /is-shallow-repository/,
      '必须拦浅克隆：它的提交数被截断，会让 versionCode 比线上更小');
    // 不能有任何形式的"兜底成常量"
    assert.ok(
      !/versionCode\s*=?\s*.*\?:\s*1\b/.test(appGradle),
      '不允许把 versionCode 兜底成 1',
    );
  });

  it('留了应急指定的口子（CI / 手工发版）', () => {
    assert.match(appGradle, /TIANWANG_VERSION_CODE/,
      '必须支持用环境变量强制指定，否则浅克隆环境下无法发版');
  });

  /* build.gradle 只保证"构建时算出来的值递增"，管不到发布这一步：
   * 手工传了个旧 APK、或 releases/ 里躺着上次的包忘了重新构建，
   * versionCode 就没变大 —— 用户点更新照样装不上，而下载页显示的是新日期，
   * 看起来一切正常。这种「静默发了个装不上的包」最难发现，
   * 所以发布脚本必须自己核对一遍。 */
  it('发布脚本要核对 versionCode 比线上大，并把它写进 apk-info.json', () => {
    const publish = read('scripts/publish-apk.sh');
    assert.match(publish, /versionCode=/,
      '发布脚本必须从 aapt2 badging 里读出 versionCode（只读 versionName 拦不住重复发版）');
    assert.match(publish, /"versionCode":/,
      'apk-info.json 要记下 versionCode，否则下一次发布只能靠 versionName 反推');
    // 没变大必须 exit 1，只 echo 一句警告等于没拦
    assert.match(publish, /versionCode 没有变大[\s\S]{0,600}?exit 1/,
      'versionCode 没变大时必须让发布失败');
  });

  /* 上面那条守卫真的救过一次：构建产物在
   *   android/app/build/outputs/apk/release/app-release.apk
   * 而发布脚本默认读
   *   releases/wuhuatianwang-android.apk
   * 这两条路径之间的拷贝当时全靠人手动做。结果是「构建成功 + 版本号正确」，
   * 但发布脚本拿的还是上一次的旧包，versionCode 没变 —— 幸好被拦下了。
   *
   * 光靠拦是不够的：拦下来只是没发错，人还得反应过来少了一步拷贝。
   * 让构建自己把产物放到发布脚本要读的位置，这一步就不可能忘。 */
  it('构建脚本要把 APK 产出到发布脚本读取的位置（否则会发出上一次的旧包）', () => {
    const buildScript = rootPkg.scripts?.['android:build'] ?? '';
    const publishDefault = /APK="\$\{1:-([^}"]+)\}"/.exec(read('scripts/publish-apk.sh'))?.[1];
    assert.ok(publishDefault, '读不出 publish-apk.sh 默认的 APK 路径');
    assert.ok(
      buildScript.includes(publishDefault!),
      `android:build 必须把产物拷到 ${publishDefault}，`
      + ' 否则构建完直接发布，发出去的是上一次的包（versionCode 不变 = 用户装不上）。'
      + ` 当前 android:build = ${buildScript}`,
    );
    assert.match(buildScript, /app-release\.apk/,
      '要从 gradle 的 release 产物拷贝，而不是别的来源');
  });
});
