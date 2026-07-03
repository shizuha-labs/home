# Cross-Surface Design System Consistency — HIVE-397

**Status:** v1 — Implementation | **Owner:** Design (Yuki) | **Pulse:** HIVE-397 | **Date:** 2026-07-03 | **Parent:** HIVE-373 (epic)

## What was done

### 1. Design Tokens (`src/styles/design-tokens.css`)
CSS custom properties covering the full token set from the HIVE-382 standard:
- **Color palette:** Primary (50–950), gray scale, semantic colors (success/warning/error/info) with light + dark mode
- **Typography:** Font family (Inter/system-ui), size scale (xs–4xl), weight scale, line heights
- **Spacing:** 4px grid (0.25rem–5rem)
- **Border radius:** sm/md/lg/xl/full
- **Shadows:** sm/md/lg/xl with dark mode overrides
- **Z-index layers:** base/dropdown/sticky/navbar/modal-backdrop/modal/toast/tooltip
- **Animation timing:** fast/normal/slow with easing

Imported via `@import` in `index.css` so all surfaces can consume them.

### 2. Global Nav Bar (`src/components/shared/GlobalNavBar.jsx`)
Replaces the old `Navbar.jsx` with the HIVE-374 spec nav:
- **Nav items:** Dashboard (/), Agents (/hive), Work (/pulse), Admin (/admin)
- **Active state:** Highlights the current surface with brand-50 background
- **Search button:** Opens an inline search overlay (Ctrl+K placeholder)
- **Theme toggle:** Preserved from old navbar
- **User menu:** Avatar + name + sign out (desktop); full mobile drawer
- **Signed-out state:** Sign in / Get Started buttons
- **Responsive:** Mobile hamburger menu with full nav items
- **Z-index:** Uses `--z-navbar` token

### 3. StatusPill (`src/components/shared/StatusPill.jsx`)
Reusable status indicator component:
- Variants: running/online (green), busy/degraded (yellow), error/offline (red), idle/stopped (gray), pending (indigo)
- Uses semantic color tokens
- Sizes: sm (12px) and md (14px)

### 4. Page Migration
All 10 pages that imported the old `Navbar` now use `GlobalNavBar`:
- LandingPage, HivePage, DocsPage, BenchmarksPage, ForgePage, ApiPage, ResearchPage, ResearchOrderPage, DojoPage, AutonomousOrgPage
- Authenticated Home view in App.jsx also uses GlobalNavBar

## What remains for full cross-surface consistency

### Phase 2 — Migration (from HIVE-382)
- [ ] Migrate Hive frontend (`/tmp/hive-repo/frontend/`) to use the same design tokens + GlobalNavBar
- [ ] Migrate Pulse frontend to use the same design tokens + GlobalNavBar
- [ ] Migrate Admin frontend to use the same design tokens + GlobalNavBar
- [ ] Publish `@shizuha/ui` package with the shared components (GlobalNavBar, StatusPill, etc.)

### Shared component inventory needed
- [ ] Audit existing `@shizuha/ui` components vs per-surface DESIGN.md files
- [ ] Define canonical token set in code (CSS custom properties done; need JS exports)
- [ ] Set up changelog + versioning for `@shizuha/ui`

### Consistency checklist items
- [ ] All surfaces use design tokens (no hardcoded colors/spacing/typography)
- [ ] All surfaces use shizuha-ui components where available
- [ ] Dark mode renders correctly on all surfaces
- [ ] Responsive at all breakpoints
- [ ] Follows spacing grid (4px increments)
- [ ] Accessibility: keyboard navigable, focus visible, color contrast ≥ 4.5:1
- [ ] Loading/empty/error states handled consistently

## Related
- HIVE-382 (Design System Governance standard)
- HIVE-374 (IA + Global Nav design spec)
- HIVE-373 (parent epic — command center)
- HIVE-376 (dashboard widgets — will consume shared components)
