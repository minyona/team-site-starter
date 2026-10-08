# team-site-starter

Node 18 or newer. No install.

```bash
node build.mjs
node check.mjs
```

`node build.mjs` checks `src/team.json` and writes `dist/`. `node check.mjs` checks that site and exits 0 when it passes, or 1 when it does not.

Sideline starter. One phone-first youth soccer team site, rendered entirely from one `team.json`.

```
src/index.html     page shell
src/app.js         renderer (reads team.json, applies privacy rules)
src/app.css        design, themed by the four colors in team.json
src/team.json      the demo team, "Sample FC U10" (all made up)
team.schema.json   JSON Schema for team.json
netlify.toml       runs node build.mjs and publishes dist/
```

To preview the built site, run `python3 -m http.server -d dist 8000` and open `http://localhost:8000`. Add `?today=2026-10-08` to pin the countdown date.

The renderer reads `window.SIDELINE_TEAM` when the build inlines it, and otherwise fetches `team.json`.

A full README comes later.
