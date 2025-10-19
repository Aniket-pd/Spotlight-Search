export function registerLifecycleEvents(context) {
  chrome.runtime.onInstalled.addListener(() => {
    context.rebuildIndex();
  });

  chrome.runtime.onStartup.addListener(() => {
    context.rebuildIndex();
  });
}

export function registerCommandShortcuts(context) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "open-launcher" || command === "open-launcher-alt") {
      context.sendToggleMessage();
    }
  });
}

export function registerDataInvalidationEvents(context) {
  chrome.tabs.onCreated.addListener(() => context.scheduleRebuild());
  chrome.tabs.onRemoved.addListener(() => context.scheduleRebuild());
  chrome.tabs.onUpdated.addListener(() => context.scheduleRebuild(1500));

  chrome.bookmarks.onCreated.addListener(() => context.scheduleRebuild(1500));
  chrome.bookmarks.onRemoved.addListener(() => context.scheduleRebuild(1500));
  chrome.bookmarks.onChanged.addListener(() => context.scheduleRebuild(1500));

  chrome.history.onVisited.addListener(() => context.scheduleRebuild(2000));
  chrome.history.onTitleChanged?.addListener(() => context.scheduleRebuild(2000));
  chrome.history.onVisitRemoved?.addListener(() => context.scheduleRebuild(2000));

  if (chrome.downloads) {
    chrome.downloads.onCreated?.addListener(() => context.scheduleRebuild(800));
    chrome.downloads.onErased?.addListener(() => context.scheduleRebuild(800));
  }
}

export function registerActionClick(context) {
  chrome.action?.onClicked?.addListener(() => {
    context.sendToggleMessage();
  });
}
