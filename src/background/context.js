const DEFAULT_REBUILD_DELAY = 600;
const FALLBACK_PAGE_URL = chrome.runtime.getURL("src/fallback/launcher.html");
const FALLBACK_SEND_ATTEMPTS = 5;
const FALLBACK_SEND_DELAY_MS = 200;

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
  };
  const faviconCache = new Map();

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

  function isFallbackTab(tab) {
    if (!tab?.url) {
      return false;
    }
    return tab.url.startsWith(FALLBACK_PAGE_URL);
  }

  function isRestrictedUrl(rawUrl) {
    if (!rawUrl) {
      return true;
    }
    const lower = rawUrl.toLowerCase();
    if (
      lower.startsWith("chrome://") ||
      lower.startsWith("chrome-untrusted://") ||
      lower.startsWith("edge://") ||
      lower.startsWith("brave://") ||
      lower.startsWith("vivaldi://") ||
      lower.startsWith("opera://") ||
      lower.startsWith("about:") ||
      lower.startsWith("devtools://") ||
      lower.startsWith("view-source:") ||
      lower.startsWith("chrome-extension://")
    ) {
      return true;
    }
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      if (host === "chrome.google.com" && url.pathname.startsWith("/webstore")) {
        return true;
      }
      if (host === "chromewebstore.google.com") {
        return true;
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  function shouldLaunchFallback(tab, error) {
    if (!tab || isFallbackTab(tab)) {
      return false;
    }
    if (isRestrictedUrl(tab.url || "")) {
      return true;
    }
    const message = typeof error?.message === "string" ? error.message : "";
    return message.includes("Receiving end does not exist");
  }

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function sendToggleWithRetry(tabId) {
    let attempt = 0;
    while (attempt < FALLBACK_SEND_ATTEMPTS) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "SPOTLIGHT_TOGGLE" });
        return true;
      } catch (err) {
        attempt += 1;
        if (attempt >= FALLBACK_SEND_ATTEMPTS) {
          throw err;
        }
        await delay(FALLBACK_SEND_DELAY_MS);
      }
    }
    return false;
  }

  let fallbackLaunchPromise = null;

  async function launchFallbackOverlay() {
    if (!fallbackLaunchPromise) {
      fallbackLaunchPromise = (async () => {
        const pattern = `${FALLBACK_PAGE_URL}*`;
        let targetTab = null;
        try {
          const existing = await chrome.tabs.query({ url: [pattern] });
          targetTab = existing.find((tab) => tab.id !== undefined) || null;
          if (targetTab && targetTab.id !== undefined) {
            await chrome.tabs.update(targetTab.id, { active: true });
          }
        } catch (err) {
          console.warn("Spotlight: failed to locate fallback tab", err);
        }

        if (!targetTab) {
          try {
            targetTab = await chrome.tabs.create({ url: FALLBACK_PAGE_URL, active: true });
          } catch (err) {
            console.warn("Spotlight: failed to open fallback tab", err);
            return;
          }
        }

        if (!targetTab || targetTab.id === undefined) {
          return;
        }

        try {
          await sendToggleWithRetry(targetTab.id);
        } catch (err) {
          console.warn("Spotlight: unable to toggle fallback overlay", err);
        }
      })().finally(() => {
        fallbackLaunchPromise = null;
      });
    }
    await fallbackLaunchPromise;
  }

  async function sendToggleMessage() {
    let activeTab = null;
    try {
      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || activeTab.id === undefined) {
        return;
      }
      await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
    } catch (err) {
      console.warn("Spotlight: unable to toggle overlay", err);
      try {
        if (shouldLaunchFallback(activeTab, err)) {
          await launchFallbackOverlay();
        }
      } catch (fallbackErr) {
        console.warn("Spotlight: fallback evaluation failed", fallbackErr);
      }
    }
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
  };
}
