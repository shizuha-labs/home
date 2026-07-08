# Home frontend local checks

Run commands from this `frontend/` directory.

## Lint

```bash
npm ci
npm run lint
```

`npm run lint` uses the checked-in `eslint.config.js` flat config and scopes ESLint to `src/` so generated `dist/` output is not linted. The config loads `eslint-plugin-react-hooks` because source files contain `react-hooks/exhaustive-deps` disable comments; without the plugin ESLint reports the rule name itself as missing instead of linting the source.

## Build

The Home app imports Shizuha shared packages directly from source:

- `@shizuha/ui` → `shizuha-ui/src`
- `@shizuha/chat` → `shizuha-chat/src`

A standalone clone of `shizuha-labs/home` is therefore not enough for a full Vite build. Use one of these supported checkout shapes:

1. **Monorepo checkout**: `<stack>/shizuha-home/frontend` with `<stack>/packages/shizuha-ui` and `<stack>/packages/shizuha-chat` present.
2. **Container/CI checkout**: `/packages/shizuha-ui` and `/packages/shizuha-chat` present. `Dockerfile.prod` and the Origin workflow assemble this shape before running the build.
3. **Custom checkout**: set `SHIZUHA_PACKAGES_DIR` to a directory containing `shizuha-ui/` and `shizuha-chat/`.

Install the shared package runtime dependencies once for the package root, matching `Dockerfile.prod`:

```bash
cd <packages>/shizuha-ui && npm install --omit=dev
cd <packages>/shizuha-chat && npm install --omit=dev
```

Then run Home checks from `frontend/`:

```bash
npm ci
npm run build
```

`npm run build` has a `prebuild` check that fails early with the supported checkout shapes if the shared package sources are missing, instead of letting Vite fail later with an unresolved `@shizuha/ui` or `@shizuha/chat` import.
