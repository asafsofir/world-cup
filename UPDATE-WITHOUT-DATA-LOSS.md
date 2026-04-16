# Update on GitHub / Railway without losing data

1. Replace only these files in your repository:
   - `public/index.html`
   - `public/app.js`
   - `public/styles.css`
   - `server/server.mjs`
2. Commit and push.
3. Let Railway redeploy.
4. Do **not** delete the Railway volume.
5. Keep `DATA_ROOT=/app/server/data` unchanged.
6. Do **not** delete `users.json` or `state.json` from the mounted volume.
7. After deploy, perform a hard refresh in the browser.

If you keep the same mounted volume and the same `DATA_ROOT`, users, predictions, standings, manual results and bonus picks remain intact.
