export const HISTORY_ASSISTANT_FLAG_KEY = "spotlightHistoryAssistantEnabled";

async function readFlagValue(key, defaultValue = false) {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return defaultValue;
  }
  try {
    const result = await chrome.storage.local.get({ [key]: defaultValue });
    return Boolean(result?.[key]);
  } catch (error) {
    console.warn("Spotlight: failed to read feature flag", key, error);
    return defaultValue;
  }
}

export async function isHistoryAssistantEnabled() {
  return readFlagValue(HISTORY_ASSISTANT_FLAG_KEY, false);
}

export function observeHistoryAssistantFlag(callback) {
  if (
    typeof chrome === "undefined" ||
    !chrome.storage ||
    !chrome.storage.onChanged ||
    typeof callback !== "function"
  ) {
    return () => {};
  }

  const listener = (changes, areaName) => {
    if (areaName !== "local" || !changes || !(HISTORY_ASSISTANT_FLAG_KEY in changes)) {
      return;
    }
    try {
      callback(Boolean(changes[HISTORY_ASSISTANT_FLAG_KEY]?.newValue));
    } catch (error) {
      console.warn("Spotlight: history assistant flag listener failed", error);
    }
  };

  try {
    chrome.storage.onChanged.addListener(listener);
  } catch (error) {
    console.warn("Spotlight: unable to observe feature flags", error);
    return () => {};
  }

  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch (error) {
      console.warn("Spotlight: failed to remove feature flag listener", error);
    }
  };
}
