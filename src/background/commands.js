import { COMMAND_REBUILD_DELAYS, isSupportedCommandAction } from "../shared/commands.js";

export function createCommandExecutor({ tabActions, scheduleRebuild }) {
  const {
    sortAllTabsByDomainAndTitle,
    shuffleTabs,
    closeTabById,
    closeAllTabsExceptActive,
    closeTabsByDomain,
    closeAudibleTabs,
  } = tabActions;

  return async function executeCommand(commandId, args = {}) {
    if (!isSupportedCommandAction(commandId)) {
      throw new Error(`Unknown command: ${commandId}`);
    }

    const rebuildDelay = COMMAND_REBUILD_DELAYS[commandId] || 0;

    switch (commandId) {
      case "tab-sort":
        await sortAllTabsByDomainAndTitle();
        scheduleRebuild(rebuildDelay);
        return;
      case "tab-shuffle":
        await shuffleTabs();
        scheduleRebuild(rebuildDelay);
        return;
      case "tab-close":
        await closeTabById(args.tabId);
        scheduleRebuild(rebuildDelay);
        return;
      case "tab-close-all":
        await closeAllTabsExceptActive();
        scheduleRebuild(rebuildDelay);
        return;
      case "tab-close-domain":
        await closeTabsByDomain(args.domain);
        scheduleRebuild(rebuildDelay);
        return;
      case "tab-close-audio":
        await closeAudibleTabs();
        scheduleRebuild(rebuildDelay);
        return;
      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  };
}
