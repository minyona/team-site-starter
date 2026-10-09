# Changelog

## 0.1.0

First public release of the Sideline starter.

- The phone site renders from `src/team.json`. The demo team is Sample FC, and every name in that file is invented.
- `node build.mjs` checks `src/team.json`, writes `dist`, and strips player last names and guardian contacts unless you turn that off.
- `node check.mjs` checks the built site.
- The weekend weather page uses each field's latitude and longitude. `?mock=1` shows the sample forecast.
- `netlify.toml` builds with `node build.mjs` and publishes `dist`. There is no package install.
- `scripts/release.mjs` writes `sideline-v0.1.0.zip` from the committed source. The zip leaves out `.git`, `.cursor`, `node_modules`, and `dist`.
