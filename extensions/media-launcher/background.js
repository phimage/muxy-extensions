"use strict";

/**
 * Media Launcher background script.
 *
 * Auto-pause keeps the built-in browser's playback in step with what the
 * coding agents are doing: media plays while the developer has nothing to do
 * in Muxy, and pauses the moment they are needed. Each rule is a switch in the
 * launcher's settings dialog (stored in `muxy.storage` under `autoPause`):
 *
 *   pauseOnWaiting   an agent asks something          -> pause
 *   pauseOnIdle      an agent finishes ("any"/"all")  -> pause
 *   resumeOnWorking  agents get back to work           -> resume
 *   resumeOnFocus    the user switches to a paused tab -> resume that tab
 *
 * The `muxy` global in a background script has no `browser` API, and page
 * webviews only get open/navigate/list/read/close — DOM evaluation lives in
 * `runScript` commands and in the `muxy` CLI. So the pause/resume itself goes
 * through `muxy.exec(["muxy", "browser", …])`, which is why the extension
 * needs `commands:exec`.
 */

const STORAGE_KEY = "autoPause";
const EVENT_STATE = "extension.autopause.state";
const EVENT_QUERY = "extension.autopause.query";
const EVENT_SET = "extension.autopause.set";

const STATUS_BAR_ITEM = "media-launcher";
const HIDE_BAR_ITEM = "media-launcher-hide";
const OVERLAY_ID = "__muxyMediaLauncherHide";
const TAB_TYPE = "media-launcher";
const FOCUS_HISTORY = 8;
const RESUME_DELAY_MS = 1200;

const DEFAULTS = Object.freeze({
  enabled: false,
  pauseOnWaiting: true,
  pauseOnIdle: "all", // "off" | "all" | "any"
  resumeOnWorking: true,
  resumeOnFocus: true,
});

const CLI_CANDIDATES = [
  "/usr/local/bin/muxy",
  "/opt/homebrew/bin/muxy",
  "/Applications/Muxy.app/Contents/Resources/muxy",
  "muxy",
];

/*
 * Page-side bookkeeping lives on `window.__muxyMediaLauncher` and keeps a
 * reference to every element *we* paused, with its position at that moment.
 * A `play` event on a held element means the user (or the site) took over, so
 * it is no longer ours to resume. A position that moved means the same thing.
 * This is what stops us from restarting something the user paused on purpose.
 */
const PAUSE_SCRIPT = `
const store = window.__muxyMediaLauncher || (window.__muxyMediaLauncher = { held: [] });
const media = document.querySelectorAll('video, audio');
let count = 0;
for (const el of media) {
  if (el.paused || el.ended || store.held.some((h) => h.el === el)) continue;
  el.pause();
  const hold = { el, time: el.currentTime, taken: false };
  const onPlay = () => { hold.taken = true; };
  el.addEventListener('play', onPlay);
  hold.release = () => el.removeEventListener('play', onPlay);
  store.held.push(hold);
  count++;
}
return count;
`;

const RESUME_SCRIPT = `
const store = window.__muxyMediaLauncher;
if (!store) return 0;
const held = store.held;
store.held = [];
let count = 0;
for (const hold of held) {
  hold.release();
  const el = hold.el;
  if (hold.taken || !el.isConnected || !el.paused || el.ended) continue;
  if (Math.abs(el.currentTime - hold.time) > 0.5) continue;
  try { await el.play(); count++; } catch (error) {}
}
return count;
`;

// Hiding paints an opaque cover over the page instead of navigating away or
// closing the tab: the page stays loaded, so the video keeps its position and
// coming back is instant. It also works when the browser shares a split with
// the terminal, where switching tabs would leave it on screen.
const HIDE_SCRIPT = `
let el = document.getElementById('${OVERLAY_ID}');
if (!el) {
  el = document.createElement('div');
  el.id = '${OVERLAY_ID}';
  el.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647';
  (document.body || document.documentElement).appendChild(el);
}
return 1;
`;

const UNHIDE_SCRIPT = `
const el = document.getElementById('${OVERLAY_ID}');
if (el) el.remove();
return el ? 1 : 0;
`;

const state = {
  settings: { ...DEFAULTS },
  agents: new Map(), // worktreeID -> "working" | "waiting"
  pausedTabs: new Set(),
  reason: null, // "waiting" | "finished" | null
  resumeTimer: 0,
  cli: null,
  execBlocked: false,
  queue: Promise.resolve(),
  // Manual hide (the status-bar button / shortcut), independent of auto-pause.
  hidden: false,
  hiddenTab: null,
  hiddenTabs: new Set(),
  focusHistory: [],
};

/* ---------------------------------------------------------------- helpers */

function normalize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) continue;
    if (key === "pauseOnIdle") {
      if (["off", "all", "any"].includes(raw[key])) out[key] = raw[key];
    } else {
      out[key] = Boolean(raw[key]);
    }
  }
  return out;
}

function readSettings() {
  try {
    return normalize(muxy.storage.get(STORAGE_KEY));
  } catch (error) {
    console.warn("media-launcher: cannot read storage —", String(error));
    return { ...DEFAULTS };
  }
}

function count(status) {
  let n = 0;
  for (const value of state.agents.values()) if (value === status) n++;
  return n;
}

async function runCLI(args) {
  if (state.execBlocked) return null;
  const candidates = state.cli ? [state.cli] : CLI_CANDIDATES;
  let lastError = null;
  for (const binary of candidates) {
    try {
      const result = await muxy.exec([binary, ...args], { timeoutMs: 8000 });
      if (result && result.exitCode !== 0) {
        throw new Error((result.stderr || "").trim() || "exit " + result.exitCode);
      }
      state.cli = binary;
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  // A denied consent prompt looks the same as a missing binary; stop retrying
  // on every single event rather than nagging the user.
  state.execBlocked = true;
  console.warn("media-launcher: muxy CLI unavailable, auto-pause off —", String(lastError));
  return null;
}

async function listBrowserTabs() {
  const result = await runCLI(["browser", "list"]);
  if (!result) return [];
  return String(result.stdout || "")
    .split("\n")
    .map((line) => line.split("\t")[0].trim())
    .filter(Boolean);
}

async function listTabs() {
  const result = await runCLI(["list-tabs"]);
  if (!result) return [];
  return String(result.stdout || "")
    .split("\n")
    .map((line) => {
      const [, id, kind, , active] = line.split("\t");
      return id ? { id: id.trim(), kind: (kind || "").trim(), active: (active || "").trim() === "true" } : null;
    })
    .filter(Boolean);
}

async function evalInTab(tabId, script) {
  const result = await runCLI(["browser", "eval", tabId, script]);
  if (!result) return 0;
  const raw = String(result.stdout || "").trim();
  const parsed = Number(raw.replace(/^"|"$/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function notify(title, body) {
  try {
    muxy.notifications.notify({ title, body });
  } catch (error) {
    console.warn("media-launcher: " + title + " — " + body);
  }
}

function setStatusBar(text) {
  try {
    muxy.statusbar.set({ id: STATUS_BAR_ITEM, text });
    muxy.statusbar.set({
      id: HIDE_BAR_ITEM,
      icon: { symbol: state.hidden ? "eye" : "eye.slash" },
    });
  } catch (error) {
    // panels:write may be denied; the indicator is optional.
  }
}

function refresh() {
  const paused = state.pausedTabs.size > 0;
  if (!paused) state.reason = null;
  setStatusBar(state.hidden ? "Hidden" : paused ? "Paused" : null);
  const payload = {
    settings: state.settings,
    paused,
    hidden: state.hidden,
    reason: state.reason,
    waiting: count("waiting"),
    working: count("working"),
    available: !state.execBlocked,
  };
  try {
    muxy.events.emit(EVENT_STATE, payload);
  } catch (error) {
    // No page open to receive it.
  }
}

/* ------------------------------------------------------------ pause/resume */

// Every CLI-driven action is serialized: agent events can arrive faster than
// `muxy browser eval` round-trips, and interleaving pause/resume would leave
// the page-side bookkeeping inconsistent.
function enqueue(action) {
  state.queue = state.queue
    .then(action)
    .catch((error) => console.warn("media-launcher: " + String(error)))
    .then(refresh);
  return state.queue;
}

async function pauseAll(reason) {
  const tabs = await listBrowserTabs();
  let total = 0;
  for (const tabId of tabs) {
    const n = await evalInTab(tabId, PAUSE_SCRIPT);
    if (n > 0) {
      state.pausedTabs.add(tabId);
      total += n;
    }
  }
  if (total > 0) {
    state.reason = reason;
    console.log("media-launcher: paused " + total + " media element(s) — " + reason);
  }
}

async function resumeTabs(tabIds) {
  let total = 0;
  for (const tabId of tabIds) {
    state.pausedTabs.delete(tabId);
    total += await evalInTab(tabId, RESUME_SCRIPT);
  }
  if (total > 0) console.log("media-launcher: resumed " + total + " media element(s)");
}

function clearResumeTimer() {
  if (state.resumeTimer) {
    clearTimeout(state.resumeTimer);
    state.resumeTimer = 0;
  }
}

function hold(reason) {
  clearResumeTimer();
  enqueue(() => pauseAll(reason));
}

// Resume after a short beat: an agent that finishes one question and
// immediately asks the next should not make the video stutter.
function release() {
  // A manual hide outranks the agents: never play into a tab the user hid.
  if (state.hidden) return;
  if (state.pausedTabs.size === 0 || state.resumeTimer) return;
  state.resumeTimer = setTimeout(() => {
    state.resumeTimer = 0;
    enqueue(() => resumeTabs([...state.pausedTabs]));
  }, RESUME_DELAY_MS);
}

function releaseNow() {
  clearResumeTimer();
  if (state.pausedTabs.size === 0) return;
  enqueue(() => resumeTabs([...state.pausedTabs]));
}

/* ------------------------------------------------------------- manual hide */

// Cover every media tab and stop its sound, remembering where the user was so
// the same button puts everything back.
async function hideMedia() {
  const browsers = await listBrowserTabs();
  if (browsers.length === 0) {
    notify(
      "Media Launcher",
      state.execBlocked
        ? "Cannot reach the muxy CLI, so the media browser cannot be hidden."
        : "No media browser tab is open."
    );
    return;
  }

  await pauseAll("hidden");
  for (const tabId of browsers) {
    await evalInTab(tabId, HIDE_SCRIPT);
    state.hiddenTabs.add(tabId);
  }
  state.hidden = true;

  // Moving off the tab is a bonus, not the mechanism: the cover already hides
  // the page, so a failure here still leaves the media hidden.
  const tabs = await listTabs();
  const active = tabs.find((tab) => tab.active);
  state.hiddenTab = active && active.kind === "browser" ? active.id : browsers[0];
  const target =
    state.focusHistory
      .map((id) => tabs.find((tab) => tab.id === id))
      .find((tab) => tab && tab.kind !== "browser") ||
    tabs.find((tab) => tab.kind === "terminal") ||
    tabs.find((tab) => tab.kind !== "browser");
  if (target && !target.active) await runCLI(["switch-tab", target.id]);
  console.log("media-launcher: media hidden (" + browsers.length + " tab(s))");
}

// Uncover and resume, wherever the request came from.
async function restoreMedia() {
  state.hidden = false;
  const covered = [...state.hiddenTabs];
  state.hiddenTabs.clear();
  for (const tabId of covered) await evalInTab(tabId, UNHIDE_SCRIPT);
  await resumeTabs([...state.pausedTabs]);
  console.log("media-launcher: media back");
}

async function showMedia() {
  state.hidden = false;
  if (state.hiddenTab) await runCLI(["switch-tab", state.hiddenTab]);
  await restoreMedia();
}

/* ------------------------------------------------------------ transitions */

function onAgentStatus(payload) {
  const worktreeID = payload && payload.worktreeID;
  if (!worktreeID) return;
  const next = payload.status;
  const prev = state.agents.get(worktreeID) || "idle";
  if (next === "working" || next === "waiting") state.agents.set(worktreeID, next);
  else state.agents.delete(worktreeID);
  if (prev === next) return;

  const s = state.settings;
  if (!s.enabled) {
    refresh();
    return;
  }
  const waiting = count("waiting");
  const working = count("working");

  if (next === "waiting") {
    if (s.pauseOnWaiting) hold("waiting");
  } else if (next === "working") {
    // The user answered, or launched a new prompt: back to work, media on.
    if (s.resumeOnWorking && waiting === 0) release();
  } else {
    const finished = prev === "working" || prev === "waiting";
    if (finished && s.pauseOnIdle === "any") {
      hold("finished");
    } else if (finished && s.pauseOnIdle === "all" && working === 0 && waiting === 0) {
      hold("finished");
    } else if (prev === "waiting" && waiting === 0 && s.resumeOnWorking) {
      // A question went away without the agent working again (cancelled or
      // session ended) and finishing is not a pause reason: nothing to wait for.
      release();
    }
  }
  refresh();
}

/* ------------------------------------------------------------ subscriptions */

muxy.events.subscribe("agent.status", onAgentStatus);

muxy.events.subscribe("tab.focused", (payload) => {
  const tabID = payload && payload.tabID;
  if (!tabID) return;
  state.focusHistory = [tabID, ...state.focusHistory.filter((id) => id !== tabID)].slice(0, FOCUS_HISTORY);

  // Going back to the hidden tab by hand is the same intent as the button.
  if (state.hidden && tabID === state.hiddenTab) {
    state.hidden = false;
    enqueue(restoreMedia);
    return;
  }
  if (state.hidden || !state.pausedTabs.has(tabID)) return;
  if (!state.settings.enabled || !state.settings.resumeOnFocus) return;
  // The user went to watch: give this tab back, whatever the agents are doing.
  enqueue(() => resumeTabs([tabID]));
});

muxy.events.subscribe("tab.closed", (payload) => {
  const tabID = payload && payload.tabID;
  if (!tabID) return;
  state.focusHistory = state.focusHistory.filter((id) => id !== tabID);
  let changed = state.pausedTabs.delete(tabID);
  // The hidden tab is gone: there is nothing left to bring back.
  state.hiddenTabs.delete(tabID);
  if (tabID === state.hiddenTab) {
    state.hiddenTab = null;
    state.hidden = false;
    changed = true;
  }
  if (changed) refresh();
});

// The manifest `openTab` action has no singleton option, so the command is a
// plain event and the tab is opened here — `singleton` focuses the tab that is
// already open instead of stacking up a new one on every click.
muxy.events.subscribe("command.open-media-launcher", async () => {
  try {
    await muxy.tabs.open({
      kind: "extensionWebView",
      extension: { id: muxy.extensionID, tabType: TAB_TYPE, singleton: true },
    });
  } catch (error) {
    console.warn("media-launcher: cannot open the launcher tab — " + String(error));
  }
});

muxy.events.subscribe("command.hide-media", () => {
  // A deliberate press retries a CLI that failed (or was denied) earlier,
  // rather than staying dead until the extension is reloaded.
  state.execBlocked = false;
  enqueue(() => (state.hidden ? showMedia() : hideMedia()));
});

muxy.events.subscribe(EVENT_SET, (payload) => {
  state.settings = normalize(payload);
  state.execBlocked = false;
  if (!state.settings.enabled) releaseNow();
  refresh();
});

muxy.events.subscribe(EVENT_QUERY, () => {
  state.settings = readSettings();
  refresh();
});

state.settings = readSettings();
console.log("media-launcher: background ready, auto-pause " + (state.settings.enabled ? "on" : "off"));
refresh();
