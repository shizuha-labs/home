# CLAUDE.md - Shizuha Home

## Overview

**Shizuha Home** is the landing page and dashboard for the Shizuha platform. It's a **frontend-only service** (no backend).

| Setting | Value |
|---------|-------|
| URL Path | `/` (root) |
| Frontend Port | 5180 |
| Type | React SPA (no backend) |

## Access

| URL | Description |
|-----|-------------|
| `http://localhost:8080/` | Landing page (unauthenticated) |
| `http://localhost:8080/` | Dashboard with app grid (authenticated) |

## Features

- **Unauthenticated**: Marketing landing page with product showcase
- **Authenticated**: Personalized dashboard with app grid linking to all services

## Architecture

```
shizuha-home/
└── frontend/
    ├── src/
    │   ├── App.jsx                 # Router with conditional rendering
    │   ├── contexts/AuthContext.jsx # Read-only auth state
    │   ├── pages/
    │   │   ├── LandingPage.jsx     # Marketing page
    │   │   └── HomePage.jsx        # Authenticated dashboard
    │   └── components/             # Shared UI components
    └── vite.config.js              # Port 5180
```

## Auth Pattern

This service uses **read-only auth** - it only checks localStorage for existing tokens:
- `shizuha_access_token` - JWT access token
- `shizuha_user` - Cached user data

Login/logout handled by shizuha-id at `/id/login` and `/id/logout`.

## Commands

All development commands run from the `compose/` directory using the master docker-compose.yaml:

```bash
# Start service
cd compose && docker compose up -d shizuha-home

# View logs
cd compose && docker compose logs -f shizuha-home

# Production (K3s) - DO NOT USE DURING DEVELOPMENT
helm upgrade --install shizuha-home deploy/k3s/charts/shizuha-home \
  -f deploy/k3s/charts/shizuha-home/values.yaml \
  -f deploy/k3s/charts/shizuha-home/values-local.yaml
```

## Tech Stack

- React 18 + Vite 5
- Tailwind CSS
- React Router DOM

Also reference [../CLAUDE.md](../CLAUDE.md) for platform-wide rules.
