const ALL_URLS_PATTERN = "<all_urls>";
const PROBE_URL = "https://example.com/";

function getAutoDarkModeContentSetting() {
  const { contentSettings } = chrome || {};
  return (
    contentSettings?.autoDarkMode ||
    contentSettings?.automaticDarkMode ||
    null
  );
}

function mapSettingToBoolean(setting) {
  const value = typeof setting === "string" ? setting.toLowerCase() : "";
  if (value === "allow" || value === "enabled" || value === "allow_access") {
    return true;
  }
  if (value === "block" || value === "disabled") {
    return false;
  }
  return null;
}

export async function readAutomaticDarkModeState() {
  const autoDarkMode = getAutoDarkModeContentSetting();
  if (!autoDarkMode || typeof autoDarkMode.get !== "function") {
    return { supported: false, enabled: null };
  }

  return new Promise((resolve) => {
    try {
      autoDarkMode.get(
        { primaryUrl: PROBE_URL, incognito: false },
        (details) => {
          if (chrome.runtime.lastError) {
            console.warn("Spotlight: failed to read dark mode preference", chrome.runtime.lastError);
            resolve({ supported: true, enabled: null });
            return;
          }
          const enabled = mapSettingToBoolean(details?.setting);
          resolve({ supported: true, enabled });
        }
      );
    } catch (err) {
      console.warn("Spotlight: unable to query dark mode preference", err);
      resolve({ supported: true, enabled: null });
    }
  });
}

function setAutomaticDarkModeSetting(setting) {
  const autoDarkMode = getAutoDarkModeContentSetting();
  if (!autoDarkMode || typeof autoDarkMode.set !== "function") {
    return Promise.reject(new Error("Chrome dark mode controls are not available on this browser"));
  }

  return new Promise((resolve, reject) => {
    try {
      autoDarkMode.set(
        { primaryPattern: ALL_URLS_PATTERN, scope: "regular", setting },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        }
      );
    } catch (err) {
      reject(err);
    }
  });
}

export function createAppearanceActions() {
  async function setDarkModeEnabled(enabled) {
    const target = enabled ? "allow" : "block";
    await setAutomaticDarkModeSetting(target);
  }

  return {
    setDarkModeEnabled,
  };
}
