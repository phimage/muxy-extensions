# Project Cleanup

Clean up your Muxy project list from one panel: multi-select projects and
delete them, or find every project whose folder is gone and remove them all
at once.

## What it does

- Lists every project with its path, and flags rows whose folder no longer
  exists on disk with a **Missing** badge.
- **Select All** / per-row checkboxes for a manual multi-delete.
- **Select Missing (N)** selects every project flagged as missing in one
  click — pair it with **Delete Selected** to sweep them all.
- Refreshes automatically when the project list changes elsewhere in Muxy,
  and on demand via the header refresh button.
- The Home project is shown but can't be selected or deleted.

## Safety

- Deleting is irreversible: it removes the project's worktrees, branches,
  and directories from disk. This extension shows its own summary confirm
  before a batch delete, **and** Muxy asks you to confirm each project
  individually — that per-project native prompt can't be skipped.
- The "Missing" check runs `test -d <path>` via `muxy.exec` for every
  project. If that check fails or times out (rather than cleanly reporting
  present/absent), the project is shown as unknown rather than missing and
  is never auto-selected by **Select Missing** — a banner appears whenever
  any project falls into this "unknown" bucket.
- `muxy.exec` runs against the *active* workspace. If a project lives on a
  different workspace than the one you currently have active (for example,
  a remote SSH workspace while you're focused on a local one), the folder
  check may run against the wrong host and misreport that project's status.
  Muxy doesn't currently expose which workspace a project belongs to, so
  this extension can't detect or warn about that case specifically — treat
  "Missing" as a strong hint, not a guarantee, when you use multiple
  workspaces.

## Permissions

- `projects:read` — list projects, and get the live `projects.changed`
  event so the panel stays in sync.
- `projects:delete` — delete the projects you select (Muxy still prompts
  per project).
- `commands:exec` — run `test -d <path>` to check whether a project's
  folder still exists.
- `panels:write` — register the panel, topbar icon, and refresh button.

## Local development

```bash
npm install
npm run build
```

Then, in Muxy: Extensions → **Load Unpacked** → select this folder (or its
`dist/` after building). Rebuild + **Reload** in the Extensions modal to
pick up changes.
