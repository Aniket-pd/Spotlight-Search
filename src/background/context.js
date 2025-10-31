const DEFAULT_REBUILD_DELAY = 600;
const PREFERENCES_STORAGE_KEY = "spotlightPreferences";

const DEFAULT_PREFERENCES = Object.freeze({
  dataSources: {
    tabs: true,
    bookmarks: true,
    history: true,
    downloads: true,
    topSites: true,
  },
  defaultWebSearchEngineId: null,
});

function getDefaultPreferences() {
  return {
    dataSources: { ...DEFAULT_PREFERENCES.dataSources },
    defaultWebSearchEngineId: DEFAULT_PREFERENCES.defaultWebSearchEngineId,
  };
}

function normalizeDataSourcePreferences(raw) {
  const defaults = getDefaultPreferences().dataSources;
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  for (const key of Object.keys(defaults)) {
    defaults[key] = raw[key] !== false;
  }
  return defaults;
}

function normalizePreferences(raw) {
  const normalized = getDefaultPreferences();
  if (raw && typeof raw === "object") {
    normalized.dataSources = normalizeDataSourcePreferences(raw.dataSources);
    if (typeof raw.defaultWebSearchEngineId === "string" && raw.defaultWebSearchEngineId.trim()) {
      normalized.defaultWebSearchEngineId = raw.defaultWebSearchEngineId.trim();
    }
  }
  return normalized;
}

async function readStoredPreferences() {
  if (!chrome?.storage?.sync?.get) {
    return getDefaultPreferences();
  }
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(PREFERENCES_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.warn("Spotlight: failed to read preferences", chrome.runtime.lastError);
          resolve(getDefaultPreferences());
          return;
        }
        resolve(normalizePreferences(result?.[PREFERENCES_STORAGE_KEY]));
      });
    } catch (err) {
      console.warn("Spotlight: unable to read preferences", err);
      resolve(getDefaultPreferences());
    }
  });
}

export function createBackgroundContext({ buildIndex }) {
  const state = {
    indexData: null,
    buildingPromise: null,
    rebuildTimer: null,
    preferences: null,
    preferencesPromise: null,
  };
  const faviconCache = new Map();

  function applyPreferences(preferences) {
    state.preferences = normalizePreferences(preferences);
    state.preferencesPromise = null;
  }

  async function ensurePreferences() {
    if (state.preferences) {
      return state.preferences;
    }
    if (!state.preferencesPromise) {
      state.preferencesPromise = readStoredPreferences()
        .then((preferences) => {
          applyPreferences(preferences);
          return state.preferences;
        })
        .catch((err) => {
          console.warn("Spotlight: failed to ensure preferences", err);
          applyPreferences(getDefaultPreferences());
          return state.preferences;
        });
    }
    return state.preferencesPromise;
  }

  function handlePreferenceChange(changes, areaName) {
    if (areaName !== "sync" || !changes || !changes[PREFERENCES_STORAGE_KEY]) {
      return;
    }
    applyPreferences(changes[PREFERENCES_STORAGE_KEY].newValue || getDefaultPreferences());
    state.indexData = null;
    scheduleRebuild(100);
  }

  if (chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(handlePreferenceChange);
  }

  async function rebuildIndex() {
    if (!state.buildingPromise) {
      state.buildingPromise = ensurePreferences()
        .then((preferences) => buildIndex({ preferences }))
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
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id !== undefined) {
        await chrome.tabs.sendMessage(activeTab.id, { type: "SPOTLIGHT_TOGGLE" });
      }
    } catch (err) {
      console.warn("Spotlight: unable to toggle overlay", err);
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
    getPreferences: ensurePreferences,
  };
}
