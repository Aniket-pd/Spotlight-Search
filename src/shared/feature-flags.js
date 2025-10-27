const DEFAULT_FLAGS = {
  smartHistoryAssistant: true,
};

function readGlobalFlag(name) {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  const flags = globalThis.SpotlightFeatureFlags;
  if (!flags || typeof flags !== "object") {
    return undefined;
  }
  const value = flags[name];
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export function isSmartHistoryAssistantEnabled() {
  const override = readGlobalFlag("smartHistoryAssistant");
  if (typeof override === "boolean") {
    return override;
  }
  return DEFAULT_FLAGS.smartHistoryAssistant;
}

if (typeof globalThis !== "undefined") {
  const utils = (globalThis.SpotlightFeatureFlagUtils = globalThis.SpotlightFeatureFlagUtils || {});
  if (typeof utils.isSmartHistoryAssistantEnabled !== "function") {
    utils.isSmartHistoryAssistantEnabled = isSmartHistoryAssistantEnabled;
  }
}
