const THEME_STORAGE_KEY = "spotlight.theme";
const DEFAULT_THEME = "dark";

function normalizeTheme(value) {
  return value === "light" ? "light" : DEFAULT_THEME;
}

export function createThemeController() {
  let cachedTheme = null;
  let loadingPromise = null;

  async function loadThemeFromStorage() {
    if (loadingPromise) {
      return loadingPromise;
    }
    loadingPromise = chrome.storage.local
      .get([THEME_STORAGE_KEY])
      .then((data) => {
        const stored = data?.[THEME_STORAGE_KEY];
        const normalized = normalizeTheme(stored);
        cachedTheme = normalized;
        if (stored !== normalized) {
          return chrome.storage.local
            .set({ [THEME_STORAGE_KEY]: normalized })
            .then(() => normalized)
            .catch(() => normalized);
        }
        return normalized;
      })
      .catch(() => {
        cachedTheme = DEFAULT_THEME;
        return DEFAULT_THEME;
      })
      .finally(() => {
        loadingPromise = null;
      });
    return loadingPromise;
  }

  async function getTheme() {
    if (cachedTheme) {
      return cachedTheme;
    }
    return loadThemeFromStorage();
  }

  async function broadcastTheme(theme) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch (err) {
      console.warn("Spotlight: failed to query tabs for theme broadcast", err);
      return;
    }

    await Promise.all(
      tabs.map((tab) => {
        if (tab?.id === undefined) {
          return Promise.resolve();
        }
        return chrome.tabs
          .sendMessage(tab.id, { type: "SPOTLIGHT_THEME_UPDATED", theme })
          .catch(() => {});
      })
    );
  }

  async function setTheme(theme) {
    const normalized = normalizeTheme(theme);
    const current = await getTheme();
    if (current === normalized) {
      return normalized;
    }
    cachedTheme = normalized;
    try {
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: normalized });
    } catch (err) {
      console.warn("Spotlight: failed to persist theme", err);
    }
    await broadcastTheme(normalized);
    return normalized;
  }

  return {
    getTheme,
    setTheme,
  };
}
