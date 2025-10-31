const REBUILD_DELAYS = {
  "tab-sort": 400,
  "tab-shuffle": 400,
  "tab-close": 200,
  "tab-close-all": 400,
  "tab-close-domain": 400,
  "tab-close-audio": 400,
  "tab-focus": 300,
  "tab-unfocus": 300,
};

const BREATHE_MODES = new Set(["calm", "focus", "energy"]);
const BREATHE_DURATIONS = new Set(["30s", "1m", "2m"]);

function normalizeBreatheMode(mode) {
  if (typeof mode !== "string") {
    return "calm";
  }
  const value = mode.toLowerCase();
  return BREATHE_MODES.has(value) ? value : "calm";
}

function normalizeBreatheDuration(duration) {
  if (typeof duration !== "string") {
    return "1m";
  }
  const value = duration.toLowerCase();
  return BREATHE_DURATIONS.has(value) ? value : "1m";
}

export function createCommandExecutor({ tabActions, scheduleRebuild, bookmarkOrganizer, focus }) {
  const {
    sortAllTabsByDomainAndTitle,
    shuffleTabs,
    closeTabById,
    closeAllTabsExceptActive,
    closeTabsByDomain,
    closeAudibleTabs,
  } = tabActions;

  return async function executeCommand(commandId, args = {}, options = {}) {
    switch (commandId) {
      case "tab-sort":
        await sortAllTabsByDomainAndTitle();
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-shuffle":
        await shuffleTabs();
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-close":
        await closeTabById(args.tabId);
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-close-all":
        await closeAllTabsExceptActive();
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-close-domain":
        await closeTabsByDomain(args.domain);
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-close-audio":
        await closeAudibleTabs();
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-focus":
        if (!focus || typeof focus.focusTab !== "function") {
          throw new Error("Focus service unavailable");
        }
        await focus.focusTab(args.tabId);
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-unfocus":
        if (!focus || typeof focus.unfocusTab !== "function") {
          throw new Error("Focus service unavailable");
        }
        await focus.unfocusTab();
        scheduleRebuild(REBUILD_DELAYS[commandId]);
        return;
      case "tab-focus-jump":
        if (!focus || typeof focus.jumpToFocusedTab !== "function") {
          throw new Error("Focus service unavailable");
        }
        await focus.jumpToFocusedTab();
        return;
      case "bookmark-organize":
        if (!bookmarkOrganizer || typeof bookmarkOrganizer.organizeBookmarks !== "function") {
          throw new Error("Bookmark organizer unavailable");
        }
        await bookmarkOrganizer.organizeBookmarks();
        return;
      case "breathe": {
        const tabId =
          typeof options?.tabId === "number"
            ? options.tabId
            : typeof options?.sender?.tab?.id === "number"
            ? options.sender.tab.id
            : null;
        if (!Number.isInteger(tabId)) {
          throw new Error("Unable to start breathe session");
        }
        const payload = {
          type: "SPOTLIGHT_BREATHE_START",
          mode: normalizeBreatheMode(args?.mode),
          duration: normalizeBreatheDuration(args?.duration),
        };
        if (typeof args?.argsString === "string" && args.argsString) {
          payload.argsString = args.argsString;
        }
        try {
          await chrome.tabs.sendMessage(tabId, payload);
        } catch (err) {
          throw new Error("Unable to start breathing session");
        }
        return;
      }
      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  };
}
