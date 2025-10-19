const DEFAULT_REBUILD_DELAY = 600;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
    fallbackSurface: null,
    sidePanelBehaviorConfigured: false,
  };
  const faviconCache = new Map();

  function clearFallbackSurface() {
    state.fallbackSurface = null;
  }

  function setFallbackSurface(surface) {
    if (surface) {
      state.fallbackSurface = surface;
    } else {
      clearFallbackSurface();
    }
  }

  function shouldPreferSidePanel(tab) {
    const url = typeof tab?.url === "string" ? tab.url : "";
    if (!url) {
      return false;
    }
    const normalized = url.toLowerCase();
    if (normalized.startsWith("chrome://") || normalized.startsWith("edge://")) {
      return true;
    }
    if (normalized.startsWith("about:")) {
      return true;
    }
    if (normalized.startsWith("chrome-extension://")) {
      return true;
    }
    if (
      normalized.startsWith("https://chrome.google.com/webstore") ||
      normalized.startsWith("https://chromewebstore.google.com")
    ) {
      return true;
    }
    return false;
  }

  async function ensureSidePanelBehaviorConfigured() {
    if (state.sidePanelBehaviorConfigured) {
      return;
    }
    if (!chrome.sidePanel || typeof chrome.sidePanel.setPanelBehavior !== "function") {
      state.sidePanelBehaviorConfigured = true;
      return;
    }
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    } catch (err) {
      console.warn("Spotlight: unable to configure side panel behavior", err);
    } finally {
      state.sidePanelBehaviorConfigured = true;
    }
  }

  async function toggleStandaloneSurface() {
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "SPOTLIGHT_TOGGLE_STANDALONE" }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve();
        });
      });
      return true;
    } catch (err) {
      console.warn("Spotlight: unable to toggle standalone surface", err);
      return false;
    }
  }

  async function rebuildIndex() {
    if (!state.buildingPromise) {
      state.buildingPromise = buildIndex()
        .then((data) => {
          state.indexData = data;
          state.buildingPromise = null;
          return data;
        })
        .catch((error) => {
          console.error("Spotlight: failed to build index", error);
          state.buildingPromise = null;
          throw error;
        });
    }
    return state.buildingPromise;
  }

  async function ensureIndex() {
    if (state.indexData) {
      return state.indexData;
    }
    return rebuildIndex();
  }

  function scheduleRebuild(delay = DEFAULT_REBUILD_DELAY) {
    if (state.rebuildTimer) {
      clearTimeout(state.rebuildTimer);
    }
    state.rebuildTimer = setTimeout(() => {
      state.rebuildTimer = null;
      rebuildIndex().catch((err) => console.error("Spotlight: rebuild failed", err));
    }, delay);
  }

  async function sendToggleMessage() {
    let activeTab = null;
    try {
      [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    } catch (err) {
      console.warn("Spotlight: unable to query active tab", err);
    }

    const fallback = state.fallbackSurface;
    const preferSidePanel = shouldPreferSidePanel(activeTab);

    if (activeTab && activeTab.id !== undefined) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
        clearFallbackSurface();
        return;
      } catch (err) {
        console.warn("Spotlight: unable to toggle overlay", err);
      }

      if (
        fallback &&
        fallback.type === "tab" &&
        typeof fallback.tabId === "number" &&
        fallback.tabId === activeTab.id
      ) {
        const toggled = await toggleStandaloneSurface();
        if (toggled) {
          return;
        }
      }
    }

    if (fallback && fallback.type === "sidePanel") {
      const toggled = await toggleStandaloneSurface();
      if (toggled) {
        return;
      }
    }

    await openFallbackSurface(activeTab || null, { preferSidePanel });
  }

  async function openFallbackSurface(activeTab, options = {}) {
    const fallback = state.fallbackSurface;
    const preferSidePanel = Boolean(options?.preferSidePanel);
    let activeWindowId = typeof activeTab?.windowId === "number" ? activeTab.windowId : null;
    if (activeWindowId === null) {
      activeWindowId = await resolveWindowId(null);
    }

    if (fallback && fallback.type === "tab" && typeof fallback.tabId === "number") {
      try {
        const existingTab = await chrome.tabs.get(fallback.tabId);
        const targetWindowId = existingTab?.windowId;
        await chrome.tabs.update(fallback.tabId, { active: true });
        if (typeof targetWindowId === "number") {
          await chrome.windows.update(targetWindowId, { focused: true });
        }
        return;
      } catch (err) {
        console.warn("Spotlight: existing fallback tab unavailable", err);
        clearFallbackSurface();
      }
    } else if (fallback && fallback.type === "sidePanel") {
      let fallbackTab = null;
      if (typeof fallback.tabId === "number") {
        try {
          fallbackTab = await chrome.tabs.get(fallback.tabId);
        } catch (err) {
          console.warn("Spotlight: cached side panel tab unavailable", err);
          fallbackTab = null;
        }
      }
      const windowHint =
        typeof fallback.windowId === "number" ? fallback.windowId : activeWindowId;
      const reopened = await openSidePanelSurface(fallbackTab || activeTab || null, windowHint);
      if (reopened) {
        return;
      }
      clearFallbackSurface();
    }

    const sidePanelAvailable = Boolean(chrome.sidePanel && typeof chrome.sidePanel.open === "function");

    if (preferSidePanel && sidePanelAvailable) {
      const openedPanel = await openSidePanelSurface(activeTab || null, activeWindowId);
      if (openedPanel) {
        return;
      }
      console.warn("Spotlight: unable to open side panel on this tab");
    }

    if (!preferSidePanel || !sidePanelAvailable) {
      const openedTab = await openFallbackTab(activeTab || null);
      if (openedTab) {
        return;
      }
    }

    if (!preferSidePanel && sidePanelAvailable) {
      await openSidePanelSurface(activeTab || null, activeWindowId);
    }
  }

  async function openFallbackTab(activeTab) {
    const windowId = typeof activeTab?.windowId === "number" ? activeTab.windowId : undefined;
    const url = chrome.runtime.getURL("popup.html");
    const createProperties = { url, active: true };
    if (typeof windowId === "number") {
      createProperties.windowId = windowId;
    }

    try {
      const createdTab = await chrome.tabs.create(createProperties);
      if (createdTab && typeof createdTab.id === "number") {
        setFallbackSurface({ type: "tab", tabId: createdTab.id });
        return true;
      }
      clearFallbackSurface();
    } catch (err) {
      console.warn("Spotlight: failed to open fallback tab", err);
      clearFallbackSurface();
    }
    return false;
  }

  async function resolveWindowId(windowIdHint) {
    if (typeof windowIdHint === "number") {
      return windowIdHint;
    }

    try {
      const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (focusedTab && typeof focusedTab.windowId === "number") {
        return focusedTab.windowId;
      }
    } catch (err) {
      console.warn("Spotlight: unable to resolve focused window", err);
    }

    return null;
  }

  async function openSidePanelSurface(tab, windowIdHint) {
    if (!chrome.sidePanel || typeof chrome.sidePanel.open !== "function") {
      return false;
    }

    await ensureSidePanelBehaviorConfigured();

    const tabId = typeof tab?.id === "number" ? tab.id : null;
    const tabWindowId = typeof tab?.windowId === "number" ? tab.windowId : null;
    const targetWindowId =
      typeof tabWindowId === "number" ? tabWindowId : await resolveWindowId(windowIdHint);

    const attempts = [];
    const baseOptions = { path: "popup.html", enabled: true };

    if (tabId !== null) {
      attempts.push({
        options: { ...baseOptions, tabId },
        open: { tabId },
        surface: { type: "sidePanel", tabId, windowId: typeof tabWindowId === "number" ? tabWindowId : null },
      });
    }

    if (typeof targetWindowId === "number") {
      attempts.push({
        options: { ...baseOptions, windowId: targetWindowId },
        open: { windowId: targetWindowId },
        surface: { type: "sidePanel", tabId: null, windowId: targetWindowId },
      });
    }

    attempts.push({
      options: baseOptions,
      open: {},
      surface: {
        type: "sidePanel",
        tabId: null,
        windowId: typeof targetWindowId === "number" ? targetWindowId : null,
      },
    });

    for (const attempt of attempts) {
      if (!(attempt && attempt.open && attempt.options)) {
        // eslint-disable-next-line no-continue
        continue;
      }

      if (typeof chrome.sidePanel.setOptions === "function") {
        try {
          await chrome.sidePanel.setOptions(attempt.options);
        } catch (err) {
          console.warn("Spotlight: unable to set side panel options", err);
        }
      }

      try {
        await chrome.sidePanel.open(attempt.open);
        setFallbackSurface(attempt.surface);
        return true;
      } catch (err) {
        console.warn("Spotlight: failed to open side panel surface", err);
        clearFallbackSurface();
      }
    }

    return false;
  }

  async function closeFallbackSurface() {
    const surface = state.fallbackSurface;
    if (!surface) {
      return false;
    }

    if (surface.type === "tab" && typeof surface.tabId === "number") {
      try {
        await chrome.tabs.remove(surface.tabId);
        clearFallbackSurface();
        return true;
      } catch (err) {
        console.warn("Spotlight: failed to close fallback tab", err);
      }
    }

    if (surface.type === "sidePanel") {
      if (chrome.sidePanel) {
        const tabId = typeof surface.tabId === "number" ? surface.tabId : null;
        const windowId = typeof surface.windowId === "number" ? surface.windowId : null;
        try {
          if (tabId !== null && typeof chrome.sidePanel.setOptions === "function") {
            await chrome.sidePanel.setOptions({ tabId, enabled: false });
          } else if (typeof chrome.sidePanel.hide === "function") {
            const hideOptions = {};
            if (windowId !== null) {
              hideOptions.windowId = windowId;
            }
            await chrome.sidePanel.hide(hideOptions);
          } else if (typeof chrome.sidePanel.setOptions === "function") {
            const disableOptions = { enabled: false };
            if (windowId !== null) {
              disableOptions.windowId = windowId;
            }
            await chrome.sidePanel.setOptions(disableOptions);
          }
          clearFallbackSurface();
          return true;
        } catch (err) {
          console.warn("Spotlight: failed to hide side panel surface", err);
        }
      }
    }

    clearFallbackSurface();
    return false;
  }

  async function openItem(itemId) {
    const data = await ensureIndex();
    const item = data.items[itemId];
    if (!item) {
      throw new Error("Item not found");
    }

    if (item.type === "tab" && item.tabId !== undefined) {
      try {
        await chrome.tabs.update(item.tabId, { active: true });
        if (item.windowId !== undefined) {
          await chrome.windows.update(item.windowId, { focused: true });
        }
      } catch (err) {
        console.warn("Spotlight: failed to focus tab, opening new tab instead", err);
        await chrome.tabs.create({ url: item.url });
      }
      return;
    }

    if (item.type === "download") {
      const downloadId = item.downloadId;
      if (typeof downloadId === "number") {
        try {
          if (item.state === "complete") {
            await chrome.downloads.open(downloadId);
          } else {
            await chrome.downloads.show(downloadId);
          }
          return;
        } catch (err) {
          console.warn("Spotlight: failed to open download directly", err);
          try {
            await chrome.downloads.open(downloadId);
            return;
          } catch (openErr) {
            console.warn("Spotlight: download open fallback failed", openErr);
          }
        }
      }
      const fallbackUrl = item.fileUrl || item.url;
      if (fallbackUrl) {
        await chrome.tabs.create({ url: fallbackUrl });
      }
      return;
    }

    await chrome.tabs.create({ url: item.url });
  }

  function getItemById(itemId) {
    if (typeof itemId !== "number") {
      return null;
    }
    return state.indexData?.items?.[itemId] || null;
  }

  return {
    ensureIndex,
    rebuildIndex,
    scheduleRebuild,
    sendToggleMessage,
    openItem,
    getItemById,
    faviconCache,
    closeFallbackSurface,
  };
}
