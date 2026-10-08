# team-site-starter

Sideline starter. One phone-first youth soccer team site, rendered entirely from one `team.json`.

```
src/index.html     page shell
src/app.js         renderer (reads team.json, applies privacy rules)
src/app.css        design, themed by the four colors in team.json
src/team.json      the demo team, "Sample FC U10" (all made up)
team.schema.json   JSON Schema for team.json
netlify.toml       publishes src/, sends X-Robots-Tag: noindex
```

Run it locally with any static server, for example `python3 -m http.server -d src 8000`, then open `http://localhost:8000`. Add `?today=2026-10-08` to pin the countdown date.

The renderer reads `window.SIDELINE_TEAM` when a build step inlines it, and otherwise fetches `team.json`.

A full README comes later.
