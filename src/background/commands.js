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
      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  };
}
