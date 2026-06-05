---
name: Frontend + backend modularization
description: Backend and frontend both modularized — router now points at src/modules/* for all pages; src/pages deleted
type: project
originSessionId: d3277255-c862-4e53-86a9-3b43f2750521
---
**Backend (2026-04-08):** monolithic controllers/services/routes moved into `backend/src/modules/<module>/`. Old `controllers/`, `services/`, `routes/` locations are backward-compat re-export stubs — do not add code there. Auth and masterData modules have the clean repo→service→controller layering; others still have original code structure.

**Frontend (2026-04-13):** All pages now live at `src/modules/<domain>/pages/`. `src/App.jsx` imports every route component from modular paths. The legacy `src/pages/*.jsx` flat files (25 files) were deleted — they were stale duplicates that the router used to use. Admin tab components live at `src/modules/admin/pages/admin/`, dashboard widgets at `src/modules/dashboard/pages/dashboard/`.

**Relative import depth rule:** files at `src/modules/X/pages/File.jsx` need `../../../` to reach `src/api`, `src/context`, `src/components`. Files at `src/modules/X/pages/subdir/File.jsx` need `../../../../`.

**How to apply:** All new pages go under the relevant module. Do not recreate `src/pages/`. Mill Manager role gets a separate layout (`src/components/MillLayout.jsx`) wired via `RoleGatedShell` in App.jsx.
