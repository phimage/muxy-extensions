# project-cleanup

Muxy extension scaffolded from a starter kit. This is an npm + Vite project.

## Layout

- `package.json` — npm manifest. Identity (`name`, `version`) is at the
  top level; all Muxy fields live under the `muxy` key. A `build` script
  (Vite) is required.
- `vite.config.js` — builds to `dist/`, the directory Muxy installs.
- `scripts/copy-manifest.mjs` — copies `package.json` into `dist/` after
  the Vite build. Only `dist/` ships, so the manifest must live inside it;
  `build` runs this for you.
- `panel/` + `src/` — a single panel: `src/panel/app.js` holds the
  vanilla-JS list/select/delete UI, `src/lib/projects.js` wraps
  `muxy.projects` and the folder-existence check.

No `background.js` — every call here (`muxy.projects.list/delete`,
`muxy.exec`) is a one-shot triggered by the user, so it runs straight
from the panel page.

## Building & editing

Install deps with `npm install`, then `npm run build` to produce
`dist/`. After rebuilding, click "Reload" in the Muxy Extensions modal to
pick up the changes. (`npm run dev` runs Vite's dev server for fast
iteration.)

## Skill

Coding agents in this directory should consult the `muxy-extension`
skill in `.claude/skills/` or `.agents/skills/` before generating
manifest or runtime changes.
