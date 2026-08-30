"use strict";

(() => {
  const STORE_KEY = "muxy.media-launcher.prefs.v1";
  const grid = document.getElementById("grid");
  const sep = grid.querySelector(".card-sep");
  const customCard = document.getElementById("custom-card");
  const customTitle = document.getElementById("custom-title");
  const customUrlLabel = document.getElementById("custom-url-label");
  const removeCustomBtn = document.getElementById("remove-custom");
  const footNote = document.getElementById("foot-note");
  const urlDialog = document.getElementById("url-dialog");
  const urlDialogForm = document.getElementById("url-dialog-form");
  const urlDialogInput = document.getElementById("url-dialog-input");
  const urlDialogName = document.getElementById("url-dialog-name");
  const urlDialogCancel = document.getElementById("url-dialog-cancel");
  const openExternalBtn = document.getElementById("open-external-first");
  const resetBtn = document.getElementById("reset-layout");
  const sessionProfile = document.getElementById("session-profile");
  const autoPauseToggle = document.getElementById("autopause-toggle");
  const autoPauseLabel = document.getElementById("autopause-label");
  const settingsDialog = document.getElementById("settings-dialog");
  const settingsForm = document.getElementById("settings-form");
  const openSettingsBtn = document.getElementById("open-settings");

  const AUTO_PAUSE_KEY = "autoPause";
  const EVENT_STATE = "extension.autopause.state";
  const EVENT_QUERY = "extension.autopause.query";
  const EVENT_SET = "extension.autopause.set";
  const AUTO_PAUSE_DEFAULTS = Object.freeze({
    enabled: false,
    pauseOnWaiting: true,
    pauseOnIdle: "all", // "off" | "all" | "any"
    resumeOnWorking: true,
    resumeOnFocus: true,
  });
  let autoPause = { ...AUTO_PAUSE_DEFAULTS };

  const DEFAULT_FOOT = footNote.textContent;
  let statusTimer = 0;
  let lastOpenedURL = null;

  function allCards() {
    return [...grid.querySelectorAll(".card")];
  }

  function readPrefs() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { order: null, custom: null };
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_error) {}
    return { order: null, custom: null };
  }

  function writePrefs(prefs) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    } catch (_error) {}
  }

  function fillCustomCard(entry) {
    if (!entry || typeof entry.url !== "string") return;
    customUrlLabel.textContent = entry.url;
    customUrlLabel.title = entry.url;
    customTitle.textContent = entry.name || hostOf(entry.url);
    customCard.dataset.url = entry.url;
    customCard.dataset.custom = "1";
    customCard.hidden = false;
  }

  function hideCustomCard() {
    customCard.hidden = true;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_error) {
      return url;
    }
  }

  function placeSeparator() {
    if (!sep) return;
    const firstCloud = grid.querySelector(".card.cloud:not([hidden])");
    if (firstCloud) grid.insertBefore(sep, firstCloud);
    else grid.appendChild(sep);
  }

  function applyOrder(order) {
    const byId = new Map(allCards().map((card) => [card.dataset.id, card]));
    const placed = new Set();
    for (const id of order ?? []) {
      const card = byId.get(id);
      if (!card) continue;
      if (card === customCard) card.hidden = true;
      grid.appendChild(card);
      placed.add(id);
    }
    for (const [id, card] of byId) {
      if (placed.has(id)) continue;
      if (card === customCard) {
        if (!card.hidden) grid.appendChild(card);
        continue;
      }
      if (card.classList.contains("cloud")) {
        grid.appendChild(card);
      } else {
        const firstCloud = grid.querySelector(".card.cloud");
        if (firstCloud) grid.insertBefore(card, firstCloud);
        else grid.appendChild(card);
      }
    }
    placeSeparator();
  }

  function persistOrder() {
    const order = allCards()
      .filter((card) => !card.hidden)
      .map((card) => card.dataset.id);
    const prefs = readPrefs();
    prefs.order = order;
    writePrefs(prefs);
  }

  function showStatus(text, isError) {
    footNote.textContent = text;
    footNote.classList.toggle("is-error", Boolean(isError));
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      footNote.textContent = DEFAULT_FOOT;
      footNote.classList.remove("is-error");
    }, 6500);
  }

  function reuseTabEnabled(prefs) {
    return prefs.reuseTab !== false;
  }

  // With "same browser tab" on, the tab this launcher last opened is navigated
  // and brought to front instead of piling up one browser tab per service.
  async function findMediaTab(prefs) {
    if (!reuseTabEnabled(prefs) || !prefs.mediaTabId) return null;
    try {
      const tabs = await window.muxy.browser.list();
      return tabs?.find((tab) => tab.id === prefs.mediaTabId) ?? null;
    } catch (_error) {
      return null;
    }
  }

  async function openInBuiltInBrowser(url) {
    const prefs = readPrefs();
    try {
      const existing = await findMediaTab(prefs);
      if (existing) {
        await window.muxy.browser.navigate(existing.id, url);
        try {
          await window.muxy.tabs.switchTo(existing.id);
        } catch (_error) {
          // tabs:write denied or tab already in front; the navigation still happened.
        }
        lastOpenedURL = url;
        showStatus(`Opened in your media tab: ${url}`);
        return true;
      }
      const tabId = await window.muxy.browser.open(url);
      if (typeof tabId === "string" && tabId) {
        prefs.mediaTabId = tabId;
        writePrefs(prefs);
      }
      lastOpenedURL = url;
      showStatus(`Opened in the Muxy browser: ${url}`);
      return true;
    } catch (error) {
      showStatus(`Muxy's built-in browser refused to open it (${String(error?.message ?? error)}).`, true);
      return false;
    }
  }

  async function openInSystemBrowser(url) {
    try {
      const result = await window.muxy.exec(["/usr/bin/open", url], { timeoutMs: 5000 });
      if (result && result.exitCode !== 0) {
        throw new Error("exit " + result.exitCode);
      }
      showStatus(`Opened in the system browser: ${url}`);
      return true;
    } catch (error) {
      showStatus(`Could not open it in the system browser (${String(error?.message ?? error)}).`, true);
      return false;
    }
  }

  async function openCard(card) {
    const url = card.dataset.url;
    if (!url) return;
    const ok = await openInBuiltInBrowser(url);
    if (ok) return;
    const again = confirm("The Muxy browser could not open this service.\nOpen it in your system browser instead?");
    if (again) await openInSystemBrowser(url);
  }

  function bindCards() {
    for (const card of allCards()) {
      card.addEventListener("click", (event) => {
        if (event.target.closest(".remove-btn")) return;
        if (event.target.closest(".open-btn") || !event.target.closest("button")) {
          openCard(card);
        }
      });
      card.draggable = true;
      card.addEventListener("dragstart", (event) => {
        card.classList.add("is-dragging");
        event.dataTransfer?.setData("text/x-muxy-media-card", card.dataset.id);
        event.dataTransfer && (event.dataTransfer.effectAllowed = "move");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));

      card.addEventListener("dragover", (event) => {
        if (!card.classList.contains("is-dragging")) {
          event.preventDefault();
          card.classList.add("is-drop-target");
        }
      });
      card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));

      card.addEventListener("drop", (event) => {
        card.classList.remove("is-drop-target");
        const draggedId = event.dataTransfer?.getData("text/x-muxy-media-card");
        if (!draggedId || draggedId === card.dataset.id) return;
        event.preventDefault();
        const dragged = grid.querySelector(`.card[data-id="${CSS.escape(draggedId)}"]`);
        if (!dragged) return;
        if (dragged.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) {
          grid.insertBefore(dragged, card);
        } else {
          grid.insertBefore(dragged, card.nextSibling);
        }
        placeSeparator();
        persistOrder();
        showStatus("Order updated.");
      });
    }
  }

  function bindCustomDialog() {
    document.getElementById("open-custom").addEventListener("click", () => {
      urlDialogInput.value = "";
      urlDialogName.value = "";
      urlDialog.showModal();
    });
    urlDialogCancel.addEventListener("click", () => urlDialog.close());
    urlDialogForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = urlDialogInput.value.trim();
      const name = urlDialogName.value.trim();
      let url = raw;
      if (/^https?:\/\//i.test(raw)) {
        // already absolute
      } else if (/^[\w.-]+(\.[\w-]+)+(:\d+)?$/.test(raw)) {
        url = "https://" + raw;
      } else {
        url = "https://" + raw;
      }
      try {
        url = new URL(url).toString();
      } catch (_error) {
        showStatus("Invalid URL.", true);
        return;
      }
      const prefs = readPrefs();
      const existing = allCards().find((card) => card.dataset.url === url);
      if (existing) {
        showStatus("This service is already in the list — click it to open.");
        urlDialog.close();
        return;
      }
      const id = "custom-" + Date.now().toString(36);
      customCard.dataset.id = id;
      customCard.dataset.url = url;
      prefs.custom = { url, name };
      fillCustomCard(prefs.custom);
      grid.appendChild(customCard);
      writePrefs(prefs);
      urlDialog.close();
      showStatus("Shortcut added: " + (name || hostOf(url)));
    });
    removeCustomBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      hideCustomCard();
      const prefs = readPrefs();
      prefs.custom = null;
      const order = (prefs.order ?? []).filter((id) => id !== customCard.dataset.id);
      prefs.order = order;
      writePrefs(prefs);
      showStatus("Shortcut removed.");
    });
  }

  /* auto-pause — the background script owns the behaviour, this is its switch */

  function normalizeAutoPause(raw) {
    const out = { ...AUTO_PAUSE_DEFAULTS };
    if (!raw || typeof raw !== "object") return out;
    for (const key of Object.keys(AUTO_PAUSE_DEFAULTS)) {
      if (!(key in raw)) continue;
      if (key === "pauseOnIdle") {
        if (["off", "all", "any"].includes(raw[key])) out[key] = raw[key];
      } else {
        out[key] = Boolean(raw[key]);
      }
    }
    return out;
  }

  function paintAutoPause({ paused, reason, available }) {
    const enabled = autoPause.enabled;
    autoPauseToggle.classList.toggle("is-on", enabled);
    autoPauseToggle.classList.toggle("is-paused", Boolean(paused));
    autoPauseToggle.setAttribute("aria-checked", enabled ? "true" : "false");
    autoPauseLabel.textContent = paused ? "Paused" : "Auto-pause";
    if (available === false) {
      autoPauseToggle.title = "Auto-pause is unavailable — the muxy CLI could not be run.";
    } else if (paused) {
      autoPauseToggle.title = reason === "finished"
        ? "Paused: an agent finished its turn"
        : "Paused: an agent is waiting for your answer";
    } else {
      autoPauseToggle.title = enabled
        ? "Playback follows the agents: pauses when they need you, resumes when they work"
        : "Pause playback when a coding agent needs you";
    }
    paintSettingsForm();
  }

  function paintSettingsForm() {
    if (!settingsForm) return;
    for (const [key, value] of Object.entries(autoPause)) {
      const field = settingsForm.elements[key];
      if (!field) continue;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = String(value);
    }
    const reuse = settingsForm.elements.reuseTab;
    if (reuse) reuse.checked = reuseTabEnabled(readPrefs());
    const group = settingsForm.querySelector(".d-group");
    if (group) group.classList.toggle("is-off", !autoPause.enabled);
  }

  async function saveAutoPause(patch) {
    const previous = autoPause;
    autoPause = normalizeAutoPause({ ...autoPause, ...patch });
    paintAutoPause({ paused: false });
    try {
      await window.muxy.storage.set(AUTO_PAUSE_KEY, autoPause);
    } catch (error) {
      autoPause = previous;
      paintAutoPause({ paused: false });
      showStatus(`Could not save the setting (${String(error?.message ?? error)}).`, true);
      return;
    }
    try {
      await window.muxy.events.emit(EVENT_SET, autoPause);
    } catch (_error) {
      showStatus("Setting saved, but the background script is not running — reload the extension.", true);
      return;
    }
    if ("enabled" in patch) {
      showStatus(
        autoPause.enabled
          ? "Auto-pause on: playback follows what the agents are doing."
          : "Auto-pause off."
      );
    }
  }

  async function bindAutoPause() {
    if (!window.muxy?.storage || !window.muxy?.events) {
      autoPauseToggle.hidden = true;
      return;
    }
    autoPauseToggle.addEventListener("click", () => {
      saveAutoPause({ enabled: !autoPause.enabled });
    });
    window.muxy.events.subscribe(EVENT_STATE, (payload) => {
      if (payload?.settings) autoPause = normalizeAutoPause(payload.settings);
      paintAutoPause(payload ?? {});
    });
    try {
      autoPause = normalizeAutoPause(await window.muxy.storage.get(AUTO_PAUSE_KEY));
      paintAutoPause({ paused: false });
    } catch (_error) {}
    try {
      await window.muxy.events.emit(EVENT_QUERY, {});
    } catch (_error) {
      // No background script running; the stored value is still the truth.
    }
  }

  function bindSettings() {
    openSettingsBtn.addEventListener("click", () => {
      paintSettingsForm();
      settingsDialog.showModal();
    });
    settingsForm.addEventListener("change", (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
      if (field.name === "reuseTab") {
        const prefs = readPrefs();
        prefs.reuseTab = field.checked;
        writePrefs(prefs);
        showStatus(field.checked ? "Services will reuse the same browser tab." : "Each service opens its own browser tab.");
        return;
      }
      if (!(field.name in AUTO_PAUSE_DEFAULTS)) return;
      const value = field.type === "checkbox" ? field.checked : field.value;
      saveAutoPause({ [field.name]: value });
    });
  }

  function bindFooter() {
    openExternalBtn.addEventListener("click", async () => {
      const url = lastOpenedURL ?? allCards().find((card) => !card.hidden)?.dataset.url;
      if (!url) return;
      await openInSystemBrowser(url);
    });
    resetBtn.addEventListener("click", () => {
      const { reuseTab, mediaTabId } = readPrefs();
      localStorage.removeItem(STORE_KEY);
      writePrefs({ order: null, custom: null, reuseTab, mediaTabId });
      hideCustomCard();
      const defaults = allCards().filter((card) => card.dataset.default === "true");
      for (const card of defaults) grid.appendChild(card);
      customCard.hidden = true;
      placeSeparator();
      showStatus("Layout reset.");
    });
  }

  async function showActiveProfile() {
    try {
      const tabs = await window.muxy.browser.list();
      const profile = tabs?.find((tab) => tab.profile)?.profile;
      if (profile) {
        sessionProfile.textContent = "active profile: " + profile;
      }
    } catch (_error) {
      // no browser tab open yet; keep the generic label
    }
  }

  function init() {
    const prefs = readPrefs();
    if (prefs.custom) fillCustomCard(prefs.custom);
    else hideCustomCard();
    if (Array.isArray(prefs.order) && prefs.order.length) {
      applyOrder(prefs.order);
    }
    bindCards();
    bindCustomDialog();
    bindFooter();
    bindSettings();
    bindAutoPause();
    if (typeof window.muxy?.browser?.list === "function") showActiveProfile();
  }

  init();
})();
