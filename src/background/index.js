import { buildIndex } from "../search/indexer.js";
import { runSearch } from "../search/search.js";
import { createBackgroundContext } from "./context.js";
import { createTabActions } from "./tabs.js";
import { createCommandExecutor } from "./commands.js";
import { createFaviconService } from "./favicons.js";
import { registerMessageHandlers } from "./messages.js";
import { createNavigationService, registerNavigationListeners } from "./navigation.js";
import { createSummarizerService } from "./summarizer.js";
import { createBookmarkOrganizerService } from "./bookmark-organizer.js";
import { createFocusManager } from "./focus.js";
import { createHistoryAssistantService } from "./history-assistant.js";
import {
  registerLifecycleEvents,
  registerCommandShortcuts,
  registerDataInvalidationEvents,
  registerActionClick,
} from "./events.js";

let focus = null;
const context = createBackgroundContext({
  buildIndex: async ({ preferences } = {}) => {
    const data = await buildIndex({ preferences });
    if (focus && typeof focus.decorateIndex === "function") {
      return focus.decorateIndex(data);
    }
    return data;
  },
});
focus = createFocusManager({
  onStateChanged: () => {
    context.scheduleRebuild();
  },
});
const tabActions = createTabActions();
const organizer = createBookmarkOrganizerService({ scheduleRebuild: context.scheduleRebuild });
const historyAssistant = createHistoryAssistantService({ scheduleRebuild: context.scheduleRebuild });
const executeCommand = createCommandExecutor({
  tabActions,
  scheduleRebuild: context.scheduleRebuild,
  bookmarkOrganizer: organizer,
  focus,
});
const { resolveFaviconForTarget } = createFaviconService({ cache: context.faviconCache });
const navigation = createNavigationService();
const summaries = createSummarizerService();

registerNavigationListeners(navigation);

registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  summaries,
  organizer,
  focus,
  historyAssistant,
});

registerLifecycleEvents(context);
registerCommandShortcuts(context);
registerDataInvalidationEvents(context);
registerActionClick(context);
