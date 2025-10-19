import { buildIndex } from "../search/indexer.js";
import { runSearch } from "../search/search.js";
import { createBackgroundContext } from "./context.js";
import { createTabActions } from "./tabs.js";
import { createCommandExecutor } from "./commands.js";
import { createFaviconService } from "./favicons.js";
import { registerMessageHandlers } from "./messages.js";
import { createNavigationService, registerNavigationListeners } from "./navigation.js";
import { createDownloadService, registerDownloadRuntimeHooks } from "./downloads.js";
import {
  registerLifecycleEvents,
  registerCommandShortcuts,
  registerDataInvalidationEvents,
  registerActionClick,
} from "./events.js";

const context = createBackgroundContext({ buildIndex });
const tabActions = createTabActions();
const executeCommand = createCommandExecutor({ tabActions, scheduleRebuild: context.scheduleRebuild });
const { resolveFaviconForTarget } = createFaviconService({ cache: context.faviconCache });
const navigation = createNavigationService();
const downloads = createDownloadService({ scheduleRebuild: context.scheduleRebuild });

registerNavigationListeners(navigation);
registerDownloadRuntimeHooks(downloads);

registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  downloads,
});

registerLifecycleEvents(context);
registerCommandShortcuts(context);
registerDataInvalidationEvents(context);
registerActionClick(context);
