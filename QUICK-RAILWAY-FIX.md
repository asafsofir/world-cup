# Quick Railway Fix

## Why the build failed
Railway only saw a nested project folder at the repo root, so it could not find the app entry files where it expected them.

## Fastest fix on the same Railway service
Option A:
1. In Railway -> Service Settings -> Build, set **Root Directory** to `/worldcup-predictor-dev-v4.1`.
2. Redeploy.
3. If Railway still doesn't pick the Dockerfile, add service variable `RAILWAY_DOCKERFILE_PATH=/worldcup-predictor-dev-v4.1/Dockerfile` and redeploy.

Option B (cleaner):
1. Replace the repo contents with the files from this v4.2 package so `Dockerfile`, `package.json`, `public/`, and `server/` are all at the repo root.
2. Redeploy.

## Make the service public
After the deployment is healthy:
1. Railway -> Service Settings -> Networking -> Public Networking.
2. Click **Generate Domain**.
3. If needed, set `PUBLIC_BASE_URL` to the generated HTTPS URL and redeploy.

## Required variables
- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_DISPLAY_NAME`
- `SESSION_SECRET`
- `SEED_SAMPLE_USERS=false`
- `DATA_ROOT=/app/server/data` (optional if you attach a Railway volume at that path)

## Recommended volume
Attach a Railway volume to `/app/server/data` so users, sessions, and state remain persistent across redeploys.

## Optional live variables
- `API_FOOTBALL_KEY`
- `LIVE_PROVIDER=api-football`
- `PUBLIC_BASE_URL=https://<your-domain>.up.railway.app`
