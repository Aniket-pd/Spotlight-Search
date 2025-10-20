const APPEARANCE_SETTINGS_URL = "chrome://settings/appearance";
const SETTINGS_SEARCH_DARK_URL = "chrome://settings/?search=dark";
const COLOR_SCHEME_PREF = "browser.color_scheme";

function setSettingsPref(name, value) {
  return new Promise((resolve, reject) => {
    try {
      chrome.settingsPrivate.setPref(name, value, "", () => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message || "Failed to update setting"));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function openAppearanceSettings({ searchFallback = false } = {}) {
  const targetUrl = searchFallback ? SETTINGS_SEARCH_DARK_URL : APPEARANCE_SETTINGS_URL;
  try {
    const existingTabs = await chrome.tabs.query({ url: "chrome://settings/*" });
    const matchingTab = existingTabs.find((tab) => {
      if (!tab || typeof tab.url !== "string") {
        return false;
      }
      return tab.url.startsWith(APPEARANCE_SETTINGS_URL) || tab.url.startsWith(SETTINGS_SEARCH_DARK_URL);
    });

    if (matchingTab && matchingTab.id !== undefined) {
      try {
        await chrome.tabs.update(matchingTab.id, { active: true, url: targetUrl });
      } catch (err) {
        console.warn("Spotlight: failed to update existing settings tab", err);
      }
      try {
        if (matchingTab.windowId !== undefined) {
          await chrome.windows.update(matchingTab.windowId, { focused: true });
        }
      } catch (err) {
        console.warn("Spotlight: failed to focus settings window", err);
      }
      return;
    }

    await chrome.tabs.create({ url: targetUrl, active: true });
  } catch (err) {
    console.warn("Spotlight: failed to open Chrome appearance settings", err);
  }
}

async function applyColorScheme(value) {
  if (!chrome.settingsPrivate || typeof chrome.settingsPrivate.setPref !== "function") {
    return false;
  }

  try {
    await setSettingsPref(COLOR_SCHEME_PREF, value);
    return true;
  } catch (err) {
    console.warn("Spotlight: unable to apply color scheme", err);
    return false;
  }
}

export function createThemeActions() {
  async function setDarkMode() {
    const applied = await applyColorScheme("dark");
    if (!applied) {
      await openAppearanceSettings({ searchFallback: true });
    }
  }

  async function setLightMode() {
    const applied = await applyColorScheme("light");
    if (!applied) {
      await openAppearanceSettings({ searchFallback: false });
    }
  }

  return {
    enableDarkMode: setDarkMode,
    disableDarkMode: setLightMode,
  };
}
