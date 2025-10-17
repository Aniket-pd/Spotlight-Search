import {
  closeAllTabsExceptActive,
  closeTabById,
  closeTabsByDomain,
  shuffleTabs,
  sortAllTabsByDomainAndTitle,
} from "./tabActions.js";
import { scheduleRebuild } from "./indexService.js";

const COMMAND_HANDLERS = {
  "tab-sort": async () => {
    await sortAllTabsByDomainAndTitle();
    scheduleRebuild(400);
  },
  "tab-shuffle": async () => {
    await shuffleTabs();
    scheduleRebuild(400);
  },
  "tab-close": async ({ tabId }) => {
    await closeTabById(tabId);
    scheduleRebuild(200);
  },
  "tab-close-all": async () => {
    await closeAllTabsExceptActive();
    scheduleRebuild(400);
  },
  "tab-close-domain": async ({ domain }) => {
    await closeTabsByDomain(domain);
    scheduleRebuild(400);
  },
};

export async function executeCommand(commandId, args = {}) {
  const handler = COMMAND_HANDLERS[commandId];
  if (!handler) {
    throw new Error(`Unknown command: ${commandId}`);
  }
  await handler(args);
}
