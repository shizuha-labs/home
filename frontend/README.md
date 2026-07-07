# Home frontend local checks

`npm run lint` uses the checked-in `eslint.config.js` flat config and scopes ESLint to `src/` so generated `dist/` output is not linted.

The app runtime/build dependencies include local packages declared in `package.json` as `file:/packages/shizuha-ui` and `file:/packages/shizuha-chat`. Provision those paths before running full install/build checks from a fresh environment. The lint config itself does not depend on a shared ESLint package.
