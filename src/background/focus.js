const STORAGE_KEY = "spotlightFocusState";
const TITLE_PREFIX = "⭑ Focus · ";
const ACCENT_COLOR = "#f97316";
const GROUP_TITLE = "🔥 Focus";
const GROUP_COLOR = "yellow";

function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const tabId = typeof raw.tabId === "number" ? raw.tabId : null;
  if (tabId === null) {
    return null;
  }
  return {
    tabId,
    windowId: typeof raw.windowId === "number" ? raw.windowId : null,
    indexBefore: typeof raw.indexBefore === "number" ? raw.indexBefore : null,
    groupIdBefore: typeof raw.groupIdBefore === "number" ? raw.groupIdBefore : null,
    appliedGroupId: typeof raw.appliedGroupId === "number" ? raw.appliedGroupId : null,
    appliedPin: Boolean(raw.appliedPin),
    titlePrefix: typeof raw.titlePrefix === "string" && raw.titlePrefix ? raw.titlePrefix : TITLE_PREFIX,
    accentColor: typeof raw.accentColor === "string" && raw.accentColor ? raw.accentColor : ACCENT_COLOR,
    label: typeof raw.label === "string" && raw.label ? raw.label : GROUP_TITLE,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

async function safeGetTab(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch (err) {
    return null;
  }
}

async function notifyTab(tabId, payload) {
  if (typeof tabId !== "number") {
    return;
  }
  const message = {
    type: "SPOTLIGHT_FOCUS_STATE",
    active: Boolean(payload?.active),
    titlePrefix: typeof payload?.titlePrefix === "string" ? payload.titlePrefix : TITLE_PREFIX,
    accentColor: typeof payload?.accentColor === "string" ? payload.accentColor : ACCENT_COLOR,
    label: typeof payload?.label === "string" && payload.label ? payload.label : GROUP_TITLE,
  };
  try {
    const maybePromise = chrome.tabs.sendMessage(tabId, message);
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  } catch (err) {
    // Ignore failures when the tab cannot receive messages (e.g., chrome:// pages).
  }
}

async function assignFocusGroup(tabId, existingGroupId) {
  if (typeof chrome?.tabs?.group !== "function") {
    return null;
  }
  try {
    const groupId = await chrome.tabs.group(
      existingGroupId && existingGroupId >= 0
        ? { groupId: existingGroupId, tabIds: [tabId] }
        : { tabIds: [tabId] }
    );
    if (typeof chrome?.tabGroups?.update === "function") {
      await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: GROUP_COLOR });
    }
    return groupId;
  } catch (err) {
    console.warn("Spotlight: unable to assign focus group", err);
    return null;
  }
}

async function removeFromGroup(tabId) {
  if (typeof chrome?.tabs?.ungroup !== "function") {
    return;
  }
  try {
    await chrome.tabs.ungroup([tabId]);
  } catch (err) {
    console.warn("Spotlight: unable to ungroup focused tab", err);
  }
}

async function saveState(state) {
  if (!state) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return;
  }
  const payload = { [STORAGE_KEY]: state };
  await chrome.storage.local.set(payload);
}

export function createFocusService() {
  let currentState = null;
  let initialized = false;

  async function loadState() {
    if (initialized) {
      return currentState;
    }
    initialized = true;
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const candidate = sanitizeState(stored[STORAGE_KEY]);
      if (!candidate) {
        currentState = null;
        return null;
      }
      const tab = await safeGetTab(candidate.tabId);
      if (!tab) {
        currentState = null;
        await chrome.storage.local.remove(STORAGE_KEY);
        return null;
      }
      currentState = candidate;
      await ensureDecorations(tab, currentState);
      await saveState(currentState);
      return currentState;
    } catch (err) {
      console.warn("Spotlight: failed to restore focus state", err);
      currentState = null;
      return null;
    }
  }

  async function ensureDecorations(tab, state) {
    if (!tab || !state) {
      return;
    }
    if (state.appliedPin && !tab.pinned) {
      try {
        await chrome.tabs.update(tab.id, { pinned: true });
      } catch (err) {
        console.warn("Spotlight: unable to re-pin focused tab", err);
      }
    }
    if (state.appliedGroupId !== null) {
      if (tab.groupId !== state.appliedGroupId) {
        const restored = await assignFocusGroup(tab.id, state.appliedGroupId);
        if (restored === null) {
          state.appliedGroupId = null;
        } else {
          state.appliedGroupId = restored;
        }
      } else if (typeof chrome?.tabGroups?.update === "function") {
        try {
          await chrome.tabGroups.update(tab.groupId, { title: GROUP_TITLE, color: GROUP_COLOR });
        } catch (err) {
          console.warn("Spotlight: unable to refresh focus group", err);
        }
      }
    }
    await notifyTab(tab.id, { active: true, titlePrefix: state.titlePrefix, accentColor: state.accentColor, label: state.label });
  }

  async function setState(nextState) {
    currentState = nextState ? { ...nextState } : null;
    await saveState(currentState);
  }

  async function focusTab(tabId) {
    const targetTab = await safeGetTab(tabId);
    if (!targetTab) {
      throw new Error("Tab not found");
    }
    const previous = await loadState();
    if (previous && previous.tabId !== targetTab.id) {
      await clearFocus({ restore: true });
    }

    const indexBefore = typeof targetTab.index === "number" ? targetTab.index : null;
    const groupIdBefore = typeof targetTab.groupId === "number" && targetTab.groupId >= 0 ? targetTab.groupId : null;
    let appliedGroupId = null;

    if (!targetTab.pinned) {
      appliedGroupId = await assignFocusGroup(targetTab.id, null);
    }

    let appliedPin = false;
    if (!targetTab.pinned) {
      try {
        await chrome.tabs.update(targetTab.id, { pinned: true });
        appliedPin = true;
      } catch (err) {
        console.warn("Spotlight: unable to pin focused tab", err);
      }
    }

    const nextState = {
      tabId: targetTab.id,
      windowId: typeof targetTab.windowId === "number" ? targetTab.windowId : null,
      indexBefore,
      groupIdBefore,
      appliedGroupId,
      appliedPin,
      titlePrefix: TITLE_PREFIX,
      accentColor: ACCENT_COLOR,
      label: GROUP_TITLE,
      createdAt: Date.now(),
    };

    await ensureDecorations(targetTab, nextState);
    await setState(nextState);
  }

  async function focusActiveTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || typeof activeTab.id !== "number") {
      throw new Error("No active tab to focus");
    }
    await focusTab(activeTab.id);
  }

  async function clearFocus({ restore } = { restore: true }) {
    const state = await loadState();
    if (!state) {
      return;
    }
    const tab = await safeGetTab(state.tabId);
    if (restore && tab) {
      if (state.appliedPin) {
        try {
          await chrome.tabs.update(tab.id, { pinned: false });
        } catch (err) {
          console.warn("Spotlight: unable to unpin focused tab", err);
        }
        if (typeof state.indexBefore === "number" && state.indexBefore >= 0) {
          try {
            await chrome.tabs.move(tab.id, { index: state.indexBefore });
          } catch (err) {
            console.warn("Spotlight: unable to restore tab position", err);
          }
        }
      }

      if (state.appliedGroupId !== null) {
        await removeFromGroup(tab.id);
      }
      if (state.groupIdBefore !== null) {
        await assignFocusGroup(tab.id, state.groupIdBefore);
      }

      await notifyTab(tab.id, { active: false, titlePrefix: state.titlePrefix, accentColor: state.accentColor, label: state.label });
    }
    await setState(null);
  }

  async function jumpToFocus() {
    const state = await loadState();
    if (!state) {
      throw new Error("No focused tab to jump to");
    }
    const tab = await safeGetTab(state.tabId);
    if (!tab) {
      await setState(null);
      throw new Error("Focused tab is no longer available");
    }
    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (typeof state.windowId === "number") {
        await chrome.windows.update(state.windowId, { focused: true });
      }
    } catch (err) {
      console.warn("Spotlight: unable to activate focused tab", err);
      throw err;
    }
    await ensureDecorations(tab, state);
  }

  async function getState() {
    await loadState();
    return currentState ? { ...currentState } : null;
  }

  async function getStateForTab(tabId) {
    const state = await getState();
    if (!state) {
      return { active: false, state: null };
    }
    const active = state.tabId === tabId;
    return { active, state: active ? { ...state } : null };
  }

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!currentState || currentState.tabId !== tabId) {
      return;
    }
    void clearFocus({ restore: false });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!currentState || currentState.tabId !== tabId) {
      return;
    }
    if (changeInfo.status === "complete") {
      void notifyTab(tabId, {
        active: true,
        titlePrefix: currentState.titlePrefix,
        accentColor: currentState.accentColor,
        label: currentState.label,
      });
    }
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!currentState || currentState.tabId !== activeInfo.tabId) {
      return;
    }
    void notifyTab(activeInfo.tabId, {
      active: true,
      titlePrefix: currentState.titlePrefix,
      accentColor: currentState.accentColor,
      label: currentState.label,
    });
  });

  return {
    focusTab,
    focusActiveTab,
    clearFocus,
    jumpToFocus,
    getState,
    getStateForTab,
  };
}

