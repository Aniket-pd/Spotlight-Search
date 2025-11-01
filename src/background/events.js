import { browser, getActionNamespace } from "../shared/browser-shim.js";

export function registerLifecycleEvents(context) {
  const runtime = browser?.runtime;
  runtime?.onInstalled?.addListener(() => {
    context.rebuildIndex();
  });

  runtime?.onStartup?.addListener(() => {
    context.rebuildIndex();
  });

  if (!runtime?.onInstalled && !runtime?.onStartup) {
    context.rebuildIndex();
  }
}

export function registerCommandShortcuts(context) {
  browser?.commands?.onCommand?.addListener((command) => {
    if (command === "open-launcher" || command === "open-launcher-alt") {
      context.sendToggleMessage();
    }
  });
}

export function registerDataInvalidationEvents(context) {
  browser?.tabs?.onCreated?.addListener(() => context.scheduleRebuild());
  browser?.tabs?.onRemoved?.addListener(() => context.scheduleRebuild());
  browser?.tabs?.onUpdated?.addListener(() => context.scheduleRebuild(1500));

  browser?.bookmarks?.onCreated?.addListener(() => context.scheduleRebuild(1500));
  browser?.bookmarks?.onRemoved?.addListener(() => context.scheduleRebuild(1500));
  browser?.bookmarks?.onChanged?.addListener(() => context.scheduleRebuild(1500));

  browser?.history?.onVisited?.addListener(() => context.scheduleRebuild(2000));
  browser?.history?.onTitleChanged?.addListener(() => context.scheduleRebuild(2000));
  browser?.history?.onVisitRemoved?.addListener(() => context.scheduleRebuild(2000));
}

export function registerActionClick(context) {
  const actionNamespace = getActionNamespace();
  actionNamespace?.onClicked?.addListener(() => {
    context.sendToggleMessage();
  });
}
