import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
const sha = (process.env.BUILD_SHA || "").slice(0, 7) || (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; } })();
export default defineConfig({ base: './', define: { __BUILD_SHA__: JSON.stringify(sha), __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') }, test: { include: ['tests/**/*.test.ts'] } });
