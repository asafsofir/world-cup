# v4.3 patch

Files to replace in your GitHub repo:

- `public/app.js`
- `server/server.mjs`

## What changed

- World Cup 2026 groups updated to the fully confirmed line-up.
- The six late-qualifier placeholders were replaced with the actual teams:
  - Czechia
  - Bosnia and Herzegovina
  - Türkiye
  - Sweden
  - Congo DR
  - Iraq
- Team names now support Hebrew display labels in the UI.
- Top-scorer options now support Hebrew player names in the UI.
- The live-sync layer still keeps canonical English names under the hood for matching provider data.
- Knockout placeholders such as `1A`, `2B`, `Winner wc-match-101` now have Hebrew display labels.
- Trial UCL match team names now show in Hebrew in the UI.

## Deploy steps

1. Replace the two files in GitHub.
2. Commit and push.
3. Trigger a Railway redeploy (or wait for auto-deploy).
4. Hard refresh the browser after deployment.
