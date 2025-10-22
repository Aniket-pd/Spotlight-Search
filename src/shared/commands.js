const SUPPORTED_COMMAND_ACTIONS = Object.freeze([
  "tab-sort",
  "tab-shuffle",
  "tab-close",
  "tab-close-all",
  "tab-close-domain",
  "tab-close-audio",
]);

const COMMAND_REBUILD_DELAYS = Object.freeze({
  "tab-sort": 400,
  "tab-shuffle": 400,
  "tab-close": 200,
  "tab-close-all": 400,
  "tab-close-domain": 400,
  "tab-close-audio": 400,
});

const SUPPORTED_COMMAND_ACTION_SET = new Set(SUPPORTED_COMMAND_ACTIONS);

function isSupportedCommandAction(action) {
  if (typeof action !== "string" || !action) {
    return false;
  }
  return SUPPORTED_COMMAND_ACTION_SET.has(action);
}

const api = Object.freeze({
  SUPPORTED_COMMAND_ACTIONS,
  COMMAND_REBUILD_DELAYS,
  isSupportedCommandAction,
});

if (typeof globalThis !== "undefined") {
  const existing = globalThis.SpotlightCommands;
  if (!existing || typeof existing !== "object") {
    Object.defineProperty(globalThis, "SpotlightCommands", {
      value: api,
      configurable: true,
      writable: false,
      enumerable: false,
    });
  }
}

export { SUPPORTED_COMMAND_ACTIONS, COMMAND_REBUILD_DELAYS, isSupportedCommandAction };
