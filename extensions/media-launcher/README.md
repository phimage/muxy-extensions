# media-launcher

A hub for launching streaming and cloud-gaming services straight from Muxy, with your accounts already signed in — and an opt-in auto-pause that stops playback whenever a coding agent needs your answer.

## Services

The extension ships with:

| Service | URL |
|---|---|
| YouTube | `https://www.youtube.com` |
| Netflix | `https://www.netflix.com/browse` |
| Twitch | `https://www.twitch.tv` |
| Amazon Prime Video | `https://www.primevideo.com/` |
| Crunchyroll | `https://www.crunchyroll.com` |
| Disney+ | `https://www.disneyplus.com` |
| Paramount+ | `https://www.paramountplus.com` |
| HBO Max | `https://www.hbomax.com` |
| Apple TV+ | `https://tv.apple.com` |
| **Cloud gaming** |  |
| GeForce Now | `https://play.geforcenow.com` |
| Xbox Cloud Gaming | `https://www.xbox.com/en-fr/play` |
| Amazon Luna | `https://app.luna.amazon.com` |

Every tile opens in **Muxy's built-in browser** (`muxy.browser.open`), so your per-profile cookies and sessions are kept and the site runs full-page rather than in an iframe.

If a service refuses to start in the built-in browser (rare — e.g. one that insists on a CDM), the footer offers a fallback: **open in the system browser** via `/usr/bin/open`, where your accounts are signed in too.

## Auto-pause: playback follows your agents

Turn on **Auto-pause** in the launcher's topbar and playback in the built-in browser follows what the coding agents are doing: media plays while they are busy and you have nothing to do in Muxy, and pauses the moment it is your turn. The goal is zero manual play/pause during a coding session.

Each rule is a switch in the launcher's settings dialog (the gear button), so you can keep only the moments that suit you:

| Setting | Default | What it does |
|---|---|---|
| Pause when an agent needs your answer | on | A permission prompt, a plan to approve, a question: playback pauses. |
| Pause when an agent finishes | once every agent is done | Time to review. Choose *Never*, *Once every agent is done*, or *As soon as one finishes*. |
| Resume when agents get back to work | on | After you answer, or when you launch a new prompt, playback resumes (after a 1.2 s beat, so back-to-back questions do not make the video stutter). |
| Resume when you switch to the media tab | on | Focusing a tab that was auto-paused plays it again, even while an agent is still waiting. |

How it works:

- The background script subscribes to the `agent.status` event, which reports `working` / `waiting` / `idle` per worktree, and reacts to transitions: into `waiting` (pause), into `idle` from an active state (pause when finishing counts), into `working` (resume when no agent is waiting any more).
- Pausing acts on every playing `<video>` / `<audio>` in the open browser tabs and keeps a page-side record of exactly which elements it paused, with their position.
- Resuming only plays those elements back, and only if they are still ours: if you pressed play (or play then pause) in the meantime, or the position moved, or the site swapped the media, the element is left alone. Something you paused yourself is never restarted.
- `tab.focused` drives the resume-on-focus rule and `tab.closed` drops closed tabs from the record.
- The status bar item reads **Paused** while playback is held, and the topbar toggle turns accent-colored with the reason in its tooltip.

Notes and limits:

- **Off by default** — the topbar toggle is the master switch. Everything is stored in `muxy.storage` under `autoPause`. It is not a Settings-pane entry because manifest `settings` are not readable from a background script, and the background script is what needs the values.
- Pausing acts on the media element directly (more reliable than sending <kbd>Space</kbd>, which depends on which element has focus). A player embedded in a cross-origin iframe is out of reach.
- Resuming calls `HTMLMediaElement.play()`. WebKit's autoplay policy allows it for media that was already playing on that page, which is the case here.
- `muxy.browser.eval` is only exposed to `runScript` commands, and background scripts get no `muxy.browser` at all — so the background script drives the pause/resume through the `muxy` CLI (`muxy browser list` / `muxy browser eval`) via `muxy.exec`. The first call raises the usual runtime consent prompt for `exec`; choose **Allow & remember** to make auto-pause silent from then on. If the CLI cannot be run, auto-pause disables itself and says so on the toggle.
- Providers that never report `waiting` (Cursor, Pi, Antigravity, Kiro, Xal) cannot trigger the "needs your answer" rule; their `idle` still triggers the "finishes" rule. Claude Code, Codex, Droid, Grok and OpenCode report all three states.

## One media tab

**Open services in the same browser tab** (on by default, in the settings dialog) makes every tile navigate the browser tab the launcher last opened and bring it to front, instead of opening a new tab per service — one media tab to manage, and one place for auto-pause to act on. Turn it off to get a fresh tab each time.

## Hiding the media browser

Two status bar items sit on the right of the footer:

| Item | Does |
|---|---|
| **Media** | Opens the launcher, or focuses the one already open. |
| Eye | Hides the media browser: pauses everything playing, covers the page, and switches you back to the tab you were working in. Press it again (or <kbd>cmd</kbd><kbd>ctrl</kbd><kbd>M</kbd>) to bring it all back. |

Hiding paints an opaque cover over the page rather than closing the tab or navigating away, so the page stays loaded and the video keeps its position — coming back is instant, with no reload and no lost place. The cover is also what makes it work when the browser shares a split with your terminal, where switching tabs alone would leave it on screen; the tab switch is a bonus on top, not the mechanism.

The eye works whether or not auto-pause is on, and while media is hidden nothing can start it again behind your back: an agent going back to work will not resume into a hidden tab. Switching to that tab yourself counts as unhiding, so the cover lifts and playback returns. The status bar reads **Hidden** meanwhile, and the icon flips between an open and a crossed-out eye.

If there is nothing to hide, or the `muxy` CLI cannot be reached, the extension says so with a notification instead of doing nothing quietly.

The shortcut is editable in Settings → Keyboard Shortcuts. If <kbd>cmd</kbd><kbd>ctrl</kbd><kbd>M</kbd> is already taken, Muxy registers the command without a shortcut and you can assign your own there.

## Customization

- **Reorder** tiles by drag and drop.
- **New shortcut**: the `URL…` button adds any service as a custom, removable tile.
- Order, custom shortcut and the same-tab option are persisted in `localStorage`.
- **Reset** restores the default order.

## Permissions

- `browser:read` / `browser:write` — list browser tabs, open one in Muxy's built-in browser, or navigate the existing media tab.
- `tabs:read` — `muxy list-tabs`, to find which tab to switch to when hiding.
- `tabs:write` — open (or focus) the launcher tab from the palette command and the status bar item, and bring the media tab to front.
- `commands:exec` — the system-browser fallback (`/usr/bin/open`) and the `muxy` CLI calls that pause, resume, and switch tabs.
- `agents:read` — subscribe to `agent.status`. The `tab.focused` / `tab.closed` events need no permission.
- `storage:read` / `storage:write` — persist the auto-pause settings.
- `panels:write` — show **Paused** / **Hidden** on the status bar item and swap the eye icon.
- `notifications:write` — report why a hide could not happen, rather than failing silently.

## Development

See `CONTRIBUTING.md` at the root of the `muxy-app/extensions` repo.

```sh
npm install
npm run build
npm test
```

## Known limits

- No CDM injection: DRM depends on macOS's WKWebView engine (native FairPlay on Apple Silicon; no Widevine). Services that only offer HD over Widevine may cap the resolution — testing on your own machine is the real test.
- The extension needs Muxy's built-in browser to be enabled (Settings → Browser).
