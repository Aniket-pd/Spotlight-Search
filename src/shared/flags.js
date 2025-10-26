const DEFAULT_FLAGS = Object.freeze({
  smartHistoryAssistant: false,
});

export const SMART_HISTORY_ASSISTANT_FLAG = "smartHistoryAssistant";

export function getFlagOverrides() {
  if (typeof globalThis === "undefined") {
    return null;
  }
  const scope = globalThis.SpotlightFlags;
  if (!scope || typeof scope !== "object") {
    return null;
  }
  return scope;
}

export function isSmartHistoryAssistantEnabled() {
  const overrides = getFlagOverrides();
  if (overrides && typeof overrides.smartHistoryAssistant === "boolean") {
    return overrides.smartHistoryAssistant;
  }
  return DEFAULT_FLAGS.smartHistoryAssistant;
}

export function setSmartHistoryAssistantEnabled(value) {
  if (typeof globalThis === "undefined") {
    return;
  }
  if (!globalThis.SpotlightFlags || typeof globalThis.SpotlightFlags !== "object") {
    Object.defineProperty(globalThis, "SpotlightFlags", {
      value: {},
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }
  globalThis.SpotlightFlags.smartHistoryAssistant = Boolean(value);
}

if (typeof globalThis !== "undefined") {
  if (!globalThis.SpotlightFlags || typeof globalThis.SpotlightFlags !== "object") {
    Object.defineProperty(globalThis, "SpotlightFlags", {
      value: { ...DEFAULT_FLAGS },
      configurable: true,
      writable: true,
      enumerable: false,
    });
  } else if (typeof globalThis.SpotlightFlags.smartHistoryAssistant !== "boolean") {
    globalThis.SpotlightFlags.smartHistoryAssistant = DEFAULT_FLAGS.smartHistoryAssistant;
  }
}

export function getSmartHistoryAssistantFlag() {
  return isSmartHistoryAssistantEnabled();
}

export function listFlags() {
  return {
    ...DEFAULT_FLAGS,
    ...(getFlagOverrides() || {}),
  };
}
