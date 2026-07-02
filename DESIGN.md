# DESIGN.md - Shizuha Home

## Purpose

Shizuha Home serves as the main entry point to the Shizuha platform, similar to atlassian.com for Atlassian products. It provides:

1. **Marketing landing page** for new visitors
2. **App dashboard** for authenticated users

## Architecture Decisions

### Frontend-Only Service

**Decision**: No backend required initially.

**Rationale**:
- Auth state is read from shared localStorage (set by shizuha-id)
- No user-specific data storage needed
- Product information is static
- Future enhancements (recent activity) can be added later via API aggregation

### Conditional Rendering

**Decision**: Single route (`/`) with conditional content based on auth state.

**Rationale**:
- Simpler than separate routes
- No need for protected route middleware
- Seamless experience when auth state changes

### Read-Only Auth Context

**Decision**: AuthContext only reads from localStorage, doesn't perform login/logout.

**Rationale**:
- Separation of concerns (shizuha-id handles auth)
- Simpler codebase
- Cross-tab sync via storage event listener

## Component Structure

```
App
├── Routes
│   └── / -> ConditionalHome
│       ├── If unauthenticated:
│       │   └── LandingPage
│       │       ├── Navbar
│       │       ├── Hero
│       │       ├── ProductGrid
│       │       ├── FeatureSection
│       │       └── Footer
│       └── If authenticated:
│           └── HomePage
│               ├── Header
│               ├── WelcomeBanner
│               └── AppGrid
```

## Product Registry

Centralized product definitions used in both ProductGrid and AppGrid:

| Product | Icon | Color | Path |
|---------|------|-------|------|
| Pulse | HeartPulse | Indigo | /pulse/ |
| Notes | StickyNote | Sky | /notes/ |
| Wiki | BookOpen | Emerald | /wiki/ |
| Mail | Mail | Rose | /mail/ |
| Inventory | Package | Amber | /inventory/ |

## Nginx Routing

The root path `/` is handled by shizuha-home-frontend:

```nginx
location / {
    proxy_pass http://shizuha-home-frontend;
    # ... WebSocket support for HMR
}
```

This replaced the previous redirect to `/pulse/`.

## Data Flow

### Unauthenticated User
1. User visits `/`
2. AuthContext checks localStorage - no tokens found
3. `isAuthenticated = false`
4. LandingPage renders
5. User clicks "Get Started" → redirects to `/id/register`

### Authenticated User
1. User visits `/`
2. AuthContext checks localStorage - tokens found
3. Parse user data from `shizuha_user`
4. `isAuthenticated = true`, `user = {...}`
5. HomePage renders with personalized greeting
6. User clicks app card → navigates to app

### Cross-Tab Sync
1. User logs out in another tab
2. localStorage `storage` event fires
3. AuthContext updates state
4. UI re-renders to LandingPage

## Future Enhancements

1. **Recent Activity Feed**: Aggregate activity from all services via API
2. **Pinned Apps**: Let users customize their dashboard
3. **Announcements**: Platform-wide notification banner
4. **Global Search**: Search across all apps
5. **Quick Actions**: Create task, new note directly from home
