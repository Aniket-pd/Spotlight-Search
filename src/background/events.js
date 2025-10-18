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

  const downloadApi = chrome.downloads;
  if (downloadApi?.onCreated?.addListener) {
    downloadApi.onCreated.addListener(() => context.scheduleRebuild(250));
  }
  if (downloadApi?.onChanged?.addListener) {
    const IMPORTANT_DOWNLOAD_CHANGE_KEYS = new Set([
      "state",
      "filename",
      "finalUrl",
      "exists",
      "paused",
      "canResume",
      "danger",
      "bytesReceived",
      "totalBytes",
      "fileSize",
      "estimatedEndTime",
      "startTime",
      "endTime",
    ]);
    downloadApi.onChanged.addListener((delta) => {
      if (!delta) {
        return;
      }
      const keys = Object.keys(delta);
      if (keys.some((key) => IMPORTANT_DOWNLOAD_CHANGE_KEYS.has(key))) {
        context.scheduleRebuild(delta.state ? 150 : 350);
      }
    });
  }
  if (downloadApi?.onErased?.addListener) {
    downloadApi.onErased.addListener(() => context.scheduleRebuild(500));
  }
}

export function registerActionClick(context) {
  chrome.action?.onClicked?.addListener(() => {
    context.sendToggleMessage();
  });
}
