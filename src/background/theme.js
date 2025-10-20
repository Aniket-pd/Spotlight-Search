const PREVIOUS_THEME_STORAGE_KEY = "spotlight:chrome-theme:previous";
const APPLIED_FLAG_STORAGE_KEY = "spotlight:chrome-theme:applied";

const DARK_THEME_UPDATE = {
  colors: {
    frame: [32, 33, 36],
    toolbar: [45, 48, 52],
    tab_background_text: [189, 193, 198],
    tab_text: [232, 234, 237],
    bookmark_text: [242, 246, 252],
    button_background: [95, 99, 104],
    ntp_background: [33, 34, 37],
    ntp_text: [232, 234, 237],
    omnibox_background: [52, 56, 60],
    omnibox_text: [248, 249, 250],
    omnibox_results_text: [189, 193, 198],
    omnibox_results_background: [41, 42, 45],
    omnibox_results_selected_text: [255, 255, 255],
    omnibox_results_selected_background: [66, 69, 73],
  },
  properties: {
    ntp_background_alignment: "bottom",
    ntp_background_repeat: "no-repeat",
  },
};

function supportsThemeApi() {
  return (
    !!chrome.theme &&
    typeof chrome.theme.update === "function" &&
    typeof chrome.theme.reset === "function"
  );
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function hasValues(obj) {
  return isObject(obj) && Object.keys(obj).length > 0;
}

function chromeCallbackToPromise(action) {
  return new Promise((resolve, reject) => {
    try {
      action(() => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message || "Chrome theme operation failed"));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function getChromeTheme() {
  if (!supportsThemeApi() || typeof chrome.theme.getCurrent !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.theme.getCurrent((theme) => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message || "Failed to read current Chrome theme"));
          return;
        }
        resolve(theme || null);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function updateChromeTheme(theme) {
  return chromeCallbackToPromise((callback) => {
    if (!supportsThemeApi()) {
      throw new Error("Chrome theme controls are not available in this browser.");
    }
    chrome.theme.update(theme, callback);
  });
}

function resetChromeTheme() {
  return chromeCallbackToPromise((callback) => {
    if (!supportsThemeApi()) {
      throw new Error("Chrome theme controls are not available in this browser.");
    }
    chrome.theme.reset(callback);
  });
}

function getStorageValues(defaults) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(defaults, (items) => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message || "Failed to read theme state"));
          return;
        }
        resolve(items || {});
      });
    } catch (err) {
      reject(err);
    }
  });
}

function setStorageValues(values) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(values, () => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message || "Failed to persist theme state"));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function removeStorageValues(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.remove(keys, () => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message || "Failed to clear theme state"));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function getPreviousThemeState() {
  const defaults = {
    [PREVIOUS_THEME_STORAGE_KEY]: null,
    [APPLIED_FLAG_STORAGE_KEY]: false,
  };
  const values = await getStorageValues(defaults);
  return {
    previousTheme: values[PREVIOUS_THEME_STORAGE_KEY],
    isApplied: Boolean(values[APPLIED_FLAG_STORAGE_KEY]),
  };
}

async function persistThemeState({ previousTheme, isApplied }) {
  const values = {
    [PREVIOUS_THEME_STORAGE_KEY]: hasValues(previousTheme) ? previousTheme : null,
    [APPLIED_FLAG_STORAGE_KEY]: Boolean(isApplied),
  };
  await setStorageValues(values);
}

async function clearThemeState() {
  await removeStorageValues([PREVIOUS_THEME_STORAGE_KEY, APPLIED_FLAG_STORAGE_KEY]);
}

async function enableChromeDarkTheme() {
  if (!supportsThemeApi()) {
    throw new Error("Chrome theme controls are not available in this browser.");
  }

  const { previousTheme, isApplied } = await getPreviousThemeState();
  let baseTheme = previousTheme;

  if (!isApplied || !hasValues(baseTheme)) {
    try {
      baseTheme = await getChromeTheme();
    } catch (err) {
      console.warn("Spotlight: unable to capture current theme", err);
      baseTheme = null;
    }
  }

  await updateChromeTheme(DARK_THEME_UPDATE);

  try {
    await persistThemeState({ previousTheme: baseTheme, isApplied: true });
  } catch (err) {
    console.warn("Spotlight: failed to persist dark theme state", err);
    try {
      if (hasValues(baseTheme)) {
        await updateChromeTheme(baseTheme);
      } else {
        await resetChromeTheme();
      }
    } catch (restoreErr) {
      console.warn("Spotlight: failed to restore theme after persistence error", restoreErr);
    }
    throw err;
  }
}

async function disableChromeDarkTheme() {
  if (!supportsThemeApi()) {
    throw new Error("Chrome theme controls are not available in this browser.");
  }

  const { previousTheme } = await getPreviousThemeState();

  if (hasValues(previousTheme)) {
    await updateChromeTheme(previousTheme);
  } else {
    await resetChromeTheme();
  }

  await clearThemeState();
}

export function createThemeActions() {
  async function setDarkMode() {
    try {
      await enableChromeDarkTheme();
    } catch (err) {
      console.warn("Spotlight: failed to enable dark theme", err);
      throw err;
    }
  }

  async function setLightMode() {
    try {
      await disableChromeDarkTheme();
    } catch (err) {
      console.warn("Spotlight: failed to restore previous theme", err);
      throw err;
    }
  }

  return {
    enableDarkMode: setDarkMode,
    disableDarkMode: setLightMode,
  };
}
