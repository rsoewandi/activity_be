# Backend Base

Express + PostgreSQL (raw `pg` pool) backing the dashboard. Exposes `/api/activities` and `/api/dashboard`.

## Structure

```
src/
  server.js                # entry — mounts routes
  config/
    db.js                  # raw pg pool
  routes/
    activities.routes.js
    dashboard.routes.js
  controllers/
    activities.controller.js
    dashboard.controller.js
  models/
    activity.model.js      # auto-creates `activity` table on first query
```

## Quick start

```powershell
cp .env.example .env       # fill DATABASE_URL
npm install
npm run dev                # http://localhost:3001/api/health
```

## Add a new resource

1. Copy `models/activity.model.js`, `controllers/activities.controller.js`, `routes/activities.routes.js` and rename.
2. Mount the router in `src/server.js`.
