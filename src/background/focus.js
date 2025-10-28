const STORAGE_KEY = "spotlightFocusedTab";
const GROUP_TITLE = "🔥 Focus";
const GROUP_COLOR = "orange";
const TITLE_PREFIX = "⭑ Focus · ";
const ACCENT_COLOR = "#f97316";
const FOCUS_LABEL = "Focus";

function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const tabId = typeof raw.tabId === "number" ? raw.tabId : null;
  if (tabId === null) {
    return null;
  }
  const windowId = typeof raw.windowId === "number" ? raw.windowId : null;
  const groupId = typeof raw.groupId === "number" ? raw.groupId : null;
  const originalGroupId = typeof raw.originalGroupId === "number" ? raw.originalGroupId : null;
  const originalPinned = Boolean(raw.originalPinned);
  const originalIndex = Number.isInteger(raw.originalIndex) ? raw.originalIndex : null;
  const movedToFront = Boolean(raw.movedToFront);
  const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
  return {
    tabId,
    windowId,
    groupId,
    originalGroupId,
    originalPinned,
    originalIndex,
    movedToFront,
    timestamp,
  };
}

function createChangeEmitter(onStateChanged) {
  const listeners = new Set();
  if (typeof onStateChanged === "function") {
    listeners.add(onStateChanged);
  }
  return {
    emit(state) {
      for (const listener of listeners) {
        try {
          listener(state);
        } catch (err) {
          console.warn("Spotlight: focus listener failed", err);
        }
      }
    },
    add(listener) {
      if (typeof listener === "function") {
        listeners.add(listener);
      }
    },
  };
}

export function createFocusManager({ onStateChanged } = {}) {
  let cachedState = null;
  let stateLoaded = false;
  let operationQueue = Promise.resolve();
  const emitter = createChangeEmitter(onStateChanged);

  async function loadStateFromStorage() {
    if (stateLoaded) {
      return cachedState;
    }
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      cachedState = sanitizeState(result?.[STORAGE_KEY]);
    } catch (err) {
      console.warn("Spotlight: failed to load focus state", err);
      cachedState = null;
    }
    stateLoaded = true;
    return cachedState;
  }

  async function getState() {
    if (!stateLoaded) {
      await loadStateFromStorage();
    }
    return cachedState;
  }

  async function saveState(state) {
    cachedState = state ? { ...state } : null;
    stateLoaded = true;
    if (!state) {
      try {
        await chrome.storage.local.remove(STORAGE_KEY);
      } catch (err) {
        console.warn("Spotlight: failed to clear focus state", err);
      }
      return;
    }
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: cachedState });
    } catch (err) {
      console.warn("Spotlight: failed to persist focus state", err);
    }
  }

  async function ensureTab(tabId) {
    if (typeof tabId !== "number") {
      return null;
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      return tab || null;
    } catch (err) {
      return null;
    }
  }

  async function notifyTab(tabId, message) {
    if (typeof tabId !== "number") {
      return;
    }
    try {
      const maybePromise = chrome.tabs.sendMessage(tabId, message);
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch((err) => {
          if (err && err.message && err.message.includes("Receiving end does not exist")) {
            return;
          }
          console.warn("Spotlight: focus message delivery failed", err);
        });
      }
    } catch (err) {
      if (!err || !err.message || !err.message.includes("Receiving end does not exist")) {
        console.warn("Spotlight: focus message dispatch failed", err);
      }
    }
  }

  function queueOperation(task) {
    operationQueue = operationQueue.then(() => task()).catch((err) => {
      console.warn("Spotlight: focus operation failed", err);
    });
    return operationQueue;
  }

  async function focusTabInternal(tabId) {
    let targetTabId = typeof tabId === "number" ? tabId : null;
    if (targetTabId === null) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || typeof activeTab.id !== "number") {
        throw new Error("No active tab to focus");
      }
      targetTabId = activeTab.id;
    }

    const existingState = await getState();
    if (existingState?.tabId === targetTabId) {
      await applyVisuals(existingState.tabId);
      return existingState;
    }

    if (existingState?.tabId && existingState.tabId !== targetTabId) {
      await unfocusInternal();
    }

    let tab = await ensureTab(targetTabId);
    if (!tab) {
      throw new Error("Tab unavailable");
    }

    const originalPinned = Boolean(tab.pinned);
    const originalGroupId = typeof tab.groupId === "number" && tab.groupId >= 0 ? tab.groupId : null;
    const originalIndex = Number.isInteger(tab.index) ? tab.index : null;
    let groupId = null;
    let movedToFront = false;
    let unpinnedForGroup = false;

    const canUseTabGroups =
      Boolean(chrome.tabGroups) &&
      typeof chrome.tabs.group === "function" &&
      typeof chrome.tabGroups.update === "function";

    if (canUseTabGroups) {
      if (tab.pinned) {
        try {
          await chrome.tabs.update(tab.id, { pinned: false });
          unpinnedForGroup = true;
          tab = (await ensureTab(tab.id)) || tab;
        } catch (err) {
          console.warn("Spotlight: unable to unpin focused tab for grouping", err);
        }
      }
      try {
        groupId = await chrome.tabs.group({ tabIds: [tab.id] });
        await chrome.tabGroups.update(groupId, {
          title: GROUP_TITLE,
          color: GROUP_COLOR,
          collapsed: false,
        });
      } catch (err) {
        console.warn("Spotlight: unable to assign focus tab group", err);
        groupId = null;
      }
    }

    const updateOptions = { active: true, highlighted: true };
    if (!canUseTabGroups || groupId === null) {
      updateOptions.pinned = true;
    }

    try {
      await chrome.tabs.update(tab.id, updateOptions);
    } catch (err) {
      console.warn("Spotlight: unable to update focused tab", err);
      if (updateOptions.pinned) {
        try {
          await chrome.tabs.update(tab.id, { active: true, highlighted: true });
        } catch (activateErr) {
          console.warn("Spotlight: unable to activate focused tab", activateErr);
        }
      }
    }

    if (typeof tab.windowId === "number") {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (err) {
        console.warn("Spotlight: unable to focus window for focused tab", err);
      }
    }

    let refreshed = await ensureTab(tab.id);
    if (canUseTabGroups) {
      if (refreshed && typeof refreshed.groupId === "number" && refreshed.groupId >= 0) {
        groupId = refreshed.groupId;
      } else if (groupId !== null) {
        try {
          groupId = await chrome.tabs.group({ tabIds: [tab.id] });
          await chrome.tabGroups.update(groupId, {
            title: GROUP_TITLE,
            color: GROUP_COLOR,
            collapsed: false,
          });
          refreshed = (await ensureTab(tab.id)) || refreshed;
        } catch (err) {
          console.warn("Spotlight: unable to refresh focus tab group after update", err);
          groupId = null;
        }
      }
    } else {
      groupId = null;
    }

    if (canUseTabGroups && groupId !== null && typeof chrome.tabs.move === "function") {
      const shouldMoveToFront = unpinnedForGroup || !originalPinned;
      if (shouldMoveToFront) {
        try {
          await chrome.tabs.move(tab.id, { index: 0 });
          movedToFront = true;
          refreshed = (await ensureTab(tab.id)) || refreshed;
        } catch (err) {
          console.warn("Spotlight: unable to move focused tab", err);
        }
      }
    }

    const state = sanitizeState({
      tabId: refreshed?.id ?? tab.id,
      windowId: refreshed?.windowId ?? tab.windowId,
      groupId,
      originalGroupId,
      originalPinned,
      originalIndex,
      movedToFront,
      timestamp: Date.now(),
    });

    await saveState(state);
    await applyVisuals(state.tabId);
    emitter.emit(state);
    return state;
  }

  async function unfocusInternal() {
    const state = await getState();
    if (!state) {
      await saveState(null);
      emitter.emit(null);
      return null;
    }

    const tab = await ensureTab(state.tabId);

    if (tab) {
      if (state.groupId !== null && typeof chrome.tabs.ungroup === "function") {
        try {
          await chrome.tabs.ungroup(tab.id);
        } catch (err) {
          console.warn("Spotlight: unable to ungroup focused tab", err);
        }
      }

      if (
        state.originalGroupId !== null &&
        chrome.tabGroups &&
        typeof chrome.tabs.group === "function"
      ) {
        try {
          await chrome.tabs.group({ groupId: state.originalGroupId, tabIds: [tab.id] });
        } catch (err) {
          console.warn("Spotlight: unable to restore tab group", err);
        }
      }

      if (!state.originalPinned && state.movedToFront && state.originalIndex !== null) {
        if (typeof chrome.tabs.move === "function") {
          try {
            await chrome.tabs.move(tab.id, { index: Math.max(0, state.originalIndex) });
          } catch (err) {
            console.warn("Spotlight: unable to restore tab position", err);
          }
        }
      }

      try {
        await chrome.tabs.update(tab.id, { pinned: state.originalPinned });
      } catch (err) {
        console.warn("Spotlight: unable to restore tab pin state", err);
      }

      if (state.originalPinned && state.movedToFront && state.originalIndex !== null) {
        if (typeof chrome.tabs.move === "function") {
          try {
            await chrome.tabs.move(tab.id, { index: Math.max(0, state.originalIndex) });
          } catch (err) {
            console.warn("Spotlight: unable to restore pinned tab position", err);
          }
        }
      }

      await notifyTab(tab.id, { type: "SPOTLIGHT_FOCUS_CLEAR" });
    }

    await saveState(null);
    emitter.emit(null);
    return null;
  }

  async function jumpToFocusedInternal() {
    const state = await getState();
    if (!state || typeof state.tabId !== "number") {
      throw new Error("No focused tab");
    }
    const tab = await ensureTab(state.tabId);
    if (!tab) {
      await saveState(null);
      emitter.emit(null);
      throw new Error("Focused tab unavailable");
    }

    try {
      await chrome.tabs.update(tab.id, { active: true, highlighted: true });
    } catch (err) {
      console.warn("Spotlight: unable to activate focused tab", err);
    }
    if (typeof tab.windowId === "number") {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (err) {
        console.warn("Spotlight: unable to focus window for jump", err);
      }
    }
    await applyVisuals(tab.id);
    return state;
  }

  async function applyVisuals(tabId) {
    const state = await getState();
    if (state?.tabId === tabId) {
      const updatedState = await ensureGroupHighlightForState(state);
      if (updatedState?.movedToFront && typeof chrome.tabs.move === "function") {
        try {
          await chrome.tabs.move(tabId, { index: 0 });
        } catch (err) {
          console.warn("Spotlight: unable to maintain focused tab position", err);
        }
      }
    }
    await notifyTab(tabId, {
      type: "SPOTLIGHT_FOCUS_APPLY",
      accentColor: ACCENT_COLOR,
      titlePrefix: TITLE_PREFIX,
      label: FOCUS_LABEL,
    });
  }

  async function ensureGroupHighlightForState(state) {
    const current = sanitizeState(state);
    if (!current || current.groupId === null) {
      return current;
    }
    const canUseTabGroups =
      Boolean(chrome.tabGroups) &&
      typeof chrome.tabGroups.update === "function" &&
      typeof chrome.tabs.group === "function";
    if (!canUseTabGroups) {
      return current;
    }
    const tab = await ensureTab(current.tabId);
    if (!tab) {
      return current;
    }
    try {
      await chrome.tabGroups.update(current.groupId, {
        title: GROUP_TITLE,
        color: GROUP_COLOR,
        collapsed: false,
      });
      return current;
    } catch (err) {
      console.warn("Spotlight: unable to refresh focus tab group", err);
    }

    try {
      const newGroupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(newGroupId, {
        title: GROUP_TITLE,
        color: GROUP_COLOR,
        collapsed: false,
      });
      const updated = sanitizeState({
        ...current,
        groupId: newGroupId,
        timestamp: Date.now(),
      });
      await saveState(updated);
      return updated;
    } catch (err) {
      console.warn("Spotlight: unable to restore focus tab group", err);
    }

    const cleared = sanitizeState({
      ...current,
      groupId: null,
      timestamp: Date.now(),
    });
    await saveState(cleared);
    return cleared;
  }

  function attachEventListeners() {
    chrome.tabs.onRemoved.addListener((removedTabId) => {
      queueOperation(async () => {
        const state = await getState();
        if (state?.tabId === removedTabId) {
          await saveState(null);
          emitter.emit(null);
        }
      });
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo && changeInfo.status === "complete") {
        queueOperation(async () => {
          const state = await getState();
          if (state?.tabId === tabId) {
            await applyVisuals(tabId);
          }
        });
      }
      if (changeInfo && Object.prototype.hasOwnProperty.call(changeInfo, "pinned")) {
        queueOperation(async () => {
          const state = await getState();
          if (!state || state.tabId !== tabId) {
            return;
          }
          if (changeInfo.pinned === false && state.groupId === null) {
            // Re-pin to keep the focus visual state aligned when tab groups are unavailable.
            try {
              await chrome.tabs.update(tabId, { pinned: true });
            } catch (err) {
              console.warn("Spotlight: unable to maintain focused tab pin", err);
            }
            return;
          }
          if (changeInfo.pinned === true && state.groupId !== null) {
            // The user pinned the tab manually; drop the group so visuals stay consistent.
            const updatedState = sanitizeState({
              ...state,
              groupId: null,
              movedToFront: false,
              timestamp: Date.now(),
            });
            await saveState(updatedState);
          }
        });
      }
    });

    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      queueOperation(async () => {
        const state = await getState();
        if (!state || state.tabId !== removedTabId) {
          return;
        }
        const updatedState = {
          ...state,
          tabId: addedTabId,
          timestamp: Date.now(),
        };
        await saveState(updatedState);
        const tab = await ensureTab(addedTabId);
        if (tab) {
          await applyVisuals(tab.id);
        }
        emitter.emit(updatedState);
      });
    });
  }

  async function restore() {
    const state = await getState();
    if (!state || typeof state.tabId !== "number") {
      return;
    }
    const tab = await ensureTab(state.tabId);
    if (!tab) {
      await saveState(null);
      emitter.emit(null);
      return;
    }

    const highlightedState = await ensureGroupHighlightForState(state);
    if (highlightedState?.movedToFront && typeof chrome.tabs.move === "function") {
      try {
        await chrome.tabs.move(tab.id, { index: 0 });
      } catch (err) {
        console.warn("Spotlight: unable to reapply focused tab position", err);
      }
    }
    await applyVisuals(tab.id);
  }

  async function decorateIndex(data) {
    const payload = data || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const metadata = { ...(payload.metadata || {}) };
    let focusedDetails = null;
    const state = await getState();

    if (state && typeof state.tabId === "number") {
      for (const item of items) {
        if (item && item.type === "tab" && item.tabId === state.tabId) {
          item.focused = true;
          focusedDetails = {
            tabId: item.tabId,
            windowId: item.windowId,
            title: item.title,
            url: item.url,
            itemId: item.id,
          };
          break;
        }
      }
    }

    metadata.focusedTab = focusedDetails;
    return { ...payload, metadata };
  }

  queueOperation(async () => {
    await loadStateFromStorage();
    attachEventListeners();
    await restore();
  });

  return {
    focusTab(tabId) {
      return queueOperation(() => focusTabInternal(tabId));
    },
    unfocusTab() {
      return queueOperation(() => unfocusInternal());
    },
    jumpToFocusedTab() {
      return queueOperation(() => jumpToFocusedInternal());
    },
    getState,
    decorateIndex,
    getAccentColor() {
      return ACCENT_COLOR;
    },
    getTitlePrefix() {
      return TITLE_PREFIX;
    },
    getLabel() {
      return FOCUS_LABEL;
    },
    onStateChanged(listener) {
      emitter.add(listener);
    },
  };
}
