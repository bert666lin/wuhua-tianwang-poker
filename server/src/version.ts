import fs from 'node:fs';

export interface VersionInfo {
  commit: string;
  buildTime: string;
  frontendBundle: string;
}

function readBuildFile(): Partial<VersionInfo> {
  try {
    const raw = fs.readFileSync(new URL('./version.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as Partial<VersionInfo>;
  } catch {
    return {};
  }
}

/** 构建元信息：优先环境变量，部署包里则读 dist/version.json。 */
export function versionInfo(): VersionInfo {
  const file = readBuildFile();
  return {
    commit: process.env.APP_COMMIT || file.commit || 'dev',
    buildTime: process.env.APP_BUILD_TIME || file.buildTime || 'dev',
    frontendBundle: process.env.APP_FRONTEND_BUNDLE || file.frontendBundle || 'dev',
  };
}
