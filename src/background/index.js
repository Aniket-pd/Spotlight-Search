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
import { createHistoryAssistantService } from "./history-assistant.js";
import {
  registerLifecycleEvents,
  registerCommandShortcuts,
  registerDataInvalidationEvents,
  registerActionClick,
} from "./events.js";

const context = createBackgroundContext({ buildIndex });
const tabActions = createTabActions();
const organizer = createBookmarkOrganizerService({ scheduleRebuild: context.scheduleRebuild });
const historyAssistant = createHistoryAssistantService();
const executeCommand = createCommandExecutor({
  tabActions,
  scheduleRebuild: context.scheduleRebuild,
  bookmarkOrganizer: organizer,
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
  historyAssistant,
});

registerLifecycleEvents(context);
registerCommandShortcuts(context);
registerDataInvalidationEvents(context);
registerActionClick(context);
