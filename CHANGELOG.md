# v4.4 patch

## Included files
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `server/server.mjs`

## Changes
- Hebrew display for teams and top-scorer players is now wired through the UI.
- Winner and top-scorer pickers are sorted alphabetically by display name.
- Top-scorer picker is grouped by team and shows flags.
- Match cards now show flags and a friendlier visual matchup layout.
- World Cup seed remains canonical in English behind the scenes for live-sync safety.
- Team placeholders from the draw are replaced with the final qualified teams.
- Added cache-busting query strings to `index.html` so browsers pick up the new JS/CSS faster.

## Data safety
Code updates do not overwrite `server/data/users.json` or `server/data/state.json` as long as the persistent volume and `DATA_ROOT` stay unchanged.
