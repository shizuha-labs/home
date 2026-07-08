import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');

const candidateRoots = [
  process.env.SHIZUHA_PACKAGES_DIR,
  '/packages',
  resolve(frontendRoot, '../../packages'),
].filter(Boolean);

const requiredPackages = ['shizuha-ui', 'shizuha-chat'];
const packageRoot = candidateRoots.find((root) =>
  requiredPackages.every((pkg) => existsSync(resolve(root, pkg, 'src')))
);

if (!packageRoot) {
  console.error(`Missing Shizuha shared package sources required for the Home frontend build.

Checked:
${candidateRoots.map((root) => `  - ${root}`).join('\n')}

Home imports @shizuha/ui and @shizuha/chat from source during Vite builds. Run the build in one of the supported shapes:
  1. Monorepo checkout: <stack>/shizuha-home/frontend with <stack>/packages/shizuha-ui and <stack>/packages/shizuha-chat present, then run npm commands from frontend/.
  2. Container/CI checkout: provide /packages/shizuha-ui and /packages/shizuha-chat (the production Dockerfile and Origin CI do this).
  3. Custom checkout: set SHIZUHA_PACKAGES_DIR to a directory containing shizuha-ui/ and shizuha-chat/.
`);
  process.exit(1);
}

const requiredRuntimeDeps = {
  'shizuha-ui': ['lucide-react'],
  'shizuha-chat': ['react-markdown', 'remark-gfm'],
};

const missingDeps = Object.entries(requiredRuntimeDeps).flatMap(([pkg, deps]) =>
  deps
    .filter((dep) => !existsSync(resolve(packageRoot, pkg, 'node_modules', dep)))
    .map((dep) => `${pkg}: ${dep}`)
);

if (missingDeps.length > 0) {
  console.error(`Missing runtime dependencies for Shizuha shared packages under ${packageRoot}.

Missing:
${missingDeps.map((dep) => `  - ${dep}`).join('\n')}

Install shared package runtime dependencies before building Home:
  cd ${resolve(packageRoot, 'shizuha-ui')} && npm install --omit=dev
  cd ${resolve(packageRoot, 'shizuha-chat')} && npm install --omit=dev
`);
  process.exit(1);
}

console.log(`Using Shizuha shared packages from ${packageRoot}`);
