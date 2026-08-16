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

## Tests

Unit tests are the floor. They do **not** prove homepage Live, HUD continuity, or Connect leftovers. Run them first:

```bash
npm test
```

### Live operator QA (required before shipping Live / voice / homepage chat)

The bugs that shipped half-baked (leftover `Replied.`, Keyterms ghosts, HUD stuck on Speaking, unscrollable mini-chat, Live dying on Dashboard / Open full chat) are only caught by driving **https://shizuha.com** as a logged-in user.

```bash
npm run test:e2e:live
```

That sets `SHIZUHA_LIVE_E2E=1` and `BASE_URL=https://shizuha.com`, then runs `tests/e2e/live-homepage-talk.spec.js`. Credentials come from `HRITIK_USER` / `HRITIK_PASS` or `~/.shizuha/operator-ui-creds` (two lines: username, password). Do not commit or print the password.

The live suite logs in through `/id/login?continue=/`, starts Live, types a unique turn, waits for a **new** agent reply, and asserts the same surfaces the operator sees:

- the typed turn is visible in the homepage strip
- no `Replied.` / `Keyterms:` leftovers
- HUD leaves Speaking
- mini-chat and the homepage column scroll
- Open full chat and Dashboard keep the same HUD (SPA, no remount)
- thread Live / mic / speak chrome is present
- Connect conversation POST and DM reject `Replied.` with 400
- `/c/bb516974-4152-427a-a2ac-04535b5f393f` hides leftovers and can start Live

Screenshots land in `test-results/live-operator/`. A green unit run with this suite skipped is not a ship signal.
