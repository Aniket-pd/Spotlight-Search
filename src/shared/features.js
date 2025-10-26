const FEATURE_STORAGE_KEY = "spotlightFeatureFlags";
const SMART_HISTORY_ASSISTANT_FLAG = "smartHistoryAssistant";
const KNOWN_FLAGS = [SMART_HISTORY_ASSISTANT_FLAG];

const DEFAULT_FLAGS = Object.freeze({
  [SMART_HISTORY_ASSISTANT_FLAG]: false,
});

function sanitizeFlags(raw) {
  const sanitized = {};
  if (!raw || typeof raw !== "object") {
    KNOWN_FLAGS.forEach((key) => {
      sanitized[key] = DEFAULT_FLAGS[key] || false;
    });
    return sanitized;
  }
  KNOWN_FLAGS.forEach((key) => {
    const value = raw[key];
    sanitized[key] = typeof value === "boolean" ? value : Boolean(value);
  });
  return sanitized;
}

async function readFlagsFromArea(area) {
  try {
    const storage = chrome?.storage?.[area];
    if (!storage || typeof storage.get !== "function") {
      return {};
    }
    const result = await storage.get(FEATURE_STORAGE_KEY);
    const payload = result ? result[FEATURE_STORAGE_KEY] : null;
    if (!payload) {
      return {};
    }
    if (typeof payload === "object") {
      return sanitizeFlags(payload);
    }
    if (typeof payload === "boolean") {
      return { [SMART_HISTORY_ASSISTANT_FLAG]: payload };
    }
  } catch (error) {
    console.warn("Spotlight: failed to read feature flags", error);
  }
  return {};
}

async function getFeatureFlags() {
  const aggregated = { ...DEFAULT_FLAGS };
  const areas = ["sync", "local"];
  for (const area of areas) {
    const flags = await readFlagsFromArea(area);
    Object.assign(aggregated, sanitizeFlags(flags));
  }
  return aggregated;
}

async function isFeatureEnabled(key) {
  if (!KNOWN_FLAGS.includes(key)) {
    return false;
  }
  const flags = await getFeatureFlags();
  return Boolean(flags[key]);
}

function onFeatureFlagsChanged(callback) {
  if (!chrome?.storage?.onChanged || typeof chrome.storage.onChanged.addListener !== "function") {
    return () => {};
  }
  const handler = (changes, areaName) => {
    if (areaName !== "sync" && areaName !== "local") {
      return;
    }
    if (!changes || !changes[FEATURE_STORAGE_KEY]) {
      return;
    }
    try {
      const nextValue = changes[FEATURE_STORAGE_KEY]?.newValue || {};
      const flags = sanitizeFlags(nextValue);
      callback(flags, areaName);
    } catch (error) {
      console.warn("Spotlight: feature flag listener error", error);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(handler);
    } catch (error) {
      console.warn("Spotlight: failed to remove feature flag listener", error);
    }
  };
}

const api = Object.freeze({
  FEATURE_STORAGE_KEY,
  SMART_HISTORY_ASSISTANT_FLAG,
  KNOWN_FLAGS: [...KNOWN_FLAGS],
  getFeatureFlags,
  isFeatureEnabled,
  onFeatureFlagsChanged,
});

if (typeof globalThis !== "undefined") {
  const existing = typeof globalThis.SpotlightFeatures === "object" ? globalThis.SpotlightFeatures : {};
  const merged = Object.freeze({ ...existing, ...api });
  Object.defineProperty(globalThis, "SpotlightFeatures", {
    value: merged,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

export { SMART_HISTORY_ASSISTANT_FLAG, getFeatureFlags, isFeatureEnabled, onFeatureFlagsChanged };
export default api;
