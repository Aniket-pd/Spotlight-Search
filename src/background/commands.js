const REBUILD_DELAYS = {
  "tab-sort": 400,
  "tab-shuffle": 400,
  "tab-close": 200,
  "tab-close-all": 400,
  "tab-close-domain": 400,
  "tab-close-audio": 400,
};

export function createCommandExecutor({ tabActions, scheduleRebuild, bookmarkOrganizer, focus }) {
  const {
    sortAllTabsByDomainAndTitle,
    shuffleTabs,
    closeTabById,
    closeAllTabsExceptActive,
    closeTabsByDomain,
    closeAudibleTabs,
  } = tabActions;

  return async function executeCommand(commandId, args = {}) {
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
      case "bookmark-organize":
        if (!bookmarkOrganizer || typeof bookmarkOrganizer.organizeBookmarks !== "function") {
          throw new Error("Bookmark organizer unavailable");
        }
        await bookmarkOrganizer.organizeBookmarks();
        return;
      case "tab-focus": {
        if (!focus) {
          throw new Error("Focus service unavailable");
        }
        const tabId = typeof args.tabId === "number" ? args.tabId : null;
        if (tabId === null) {
          await focus.focusActiveTab();
        } else {
          await focus.focusTab(tabId);
        }
        return;
      }
      case "tab-focus-clear":
        if (!focus) {
          throw new Error("Focus service unavailable");
        }
        await focus.clearFocus();
        return;
      case "tab-focus-jump":
        if (!focus) {
          throw new Error("Focus service unavailable");
        }
        await focus.jumpToFocus();
        return;
      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  };
}
