const DEFAULT_FLAGS = {
  smartHistoryAssistant: false,
};

const STORAGE_KEY = "spotlightFeatureFlags";
const LEGACY_FLAG_KEY = "spotlightSmartHistoryAssistantEnabled";

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0;
  }
  return null;
}

async function readFlagsFromStorage() {
  if (!chrome?.storage?.local?.get) {
    return { ...DEFAULT_FLAGS };
  }
  try {
    const stored = await chrome.storage.local.get({
      [STORAGE_KEY]: null,
      [LEGACY_FLAG_KEY]: null,
    });
    const flags = { ...DEFAULT_FLAGS };
    if (stored && typeof stored[STORAGE_KEY] === "object" && stored[STORAGE_KEY] !== null) {
      const record = stored[STORAGE_KEY];
      if (typeof record.smartHistoryAssistant === "boolean") {
        flags.smartHistoryAssistant = record.smartHistoryAssistant;
      } else {
        const parsed = toBoolean(record.smartHistoryAssistant);
        if (parsed !== null) {
          flags.smartHistoryAssistant = parsed;
        }
      }
    }
    if (typeof stored?.[LEGACY_FLAG_KEY] !== "undefined") {
      const parsed = toBoolean(stored[LEGACY_FLAG_KEY]);
      if (parsed !== null) {
        flags.smartHistoryAssistant = parsed;
      }
    }
    return flags;
  } catch (error) {
    console.warn("Spotlight: failed to read feature flags", error);
    return { ...DEFAULT_FLAGS };
  }
}

let cachedFlags = null;
let pendingPromise = null;

export async function getFeatureFlags() {
  if (cachedFlags) {
    return { ...cachedFlags };
  }
  if (pendingPromise) {
    const result = await pendingPromise;
    return { ...result };
  }
  pendingPromise = readFlagsFromStorage().then((flags) => {
    cachedFlags = { ...flags };
    pendingPromise = null;
    return cachedFlags;
  });
  const result = await pendingPromise;
  return { ...result };
}

export async function isSmartHistoryAssistantEnabled() {
  const flags = await getFeatureFlags();
  return Boolean(flags.smartHistoryAssistant);
}

export function observeFeatureFlags(callback) {
  if (!chrome?.storage?.onChanged || typeof chrome.storage.onChanged.addListener !== "function") {
    return () => {};
  }
  const listener = (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (!changes) {
      return;
    }
    if (!(STORAGE_KEY in changes) && !(LEGACY_FLAG_KEY in changes)) {
      return;
    }
    cachedFlags = null;
    getFeatureFlags()
      .then((flags) => {
        if (typeof callback === "function") {
          callback({ ...flags });
        }
      })
      .catch((error) => {
        console.warn("Spotlight: feature flag refresh failed", error);
      });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch (error) {
      // ignore
    }
  };
}

export function __resetFeatureFlagCacheForTests() {
  cachedFlags = null;
  pendingPromise = null;
}
