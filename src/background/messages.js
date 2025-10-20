export function registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  performanceTracker,
  devtools,
}) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return undefined;
    }

    if (message.type === "SPOTLIGHT_QUERY") {
      const senderTabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
      const navigationState = navigation
        ? navigation.getStateForTab(senderTabId)
        : { tabId: senderTabId, back: [], forward: [] };
      context
        .ensureIndex()
        .then((data) => {
          const payload =
            runSearch(message.query || "", data, {
              subfilter: message.subfilter,
              navigation: navigationState,
            }) || {};
          if (!payload.results || !Array.isArray(payload.results)) {
            payload.results = [];
          }
          sendResponse({ ...payload, requestId: message.requestId });
        })
        .catch((err) => {
          console.error("Spotlight: query failed", err);
          sendResponse({ results: [], error: true, requestId: message.requestId });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_FAVICON") {
      context
        .ensureIndex()
        .then(async (data) => {
          const item = typeof message.itemId === "number" ? data.items[message.itemId] : null;
          const target = {
            type: item?.type || message.resultType || null,
            tabId:
              typeof item?.tabId === "number"
                ? item.tabId
                : typeof message.tabId === "number"
                ? message.tabId
                : null,
            url: item?.url || message.url || "",
            origin: item?.origin || message.origin || "",
          };
          const { origin, faviconUrl } = await resolveFaviconForTarget(target);
          sendResponse({ success: Boolean(faviconUrl), faviconUrl, origin });
        })
        .catch((err) => {
          console.warn("Spotlight: favicon resolve failed", err);
          sendResponse({ success: false, faviconUrl: null, origin: message.origin || "" });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_OPEN") {
      context
        .openItem(message.itemId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error("Spotlight: open failed", err);
          sendResponse({ success: false, error: err?.message });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_REINDEX") {
      context
        .rebuildIndex()
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error("Spotlight: reindex failed", err);
          sendResponse({ success: false, error: err?.message });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_COMMAND") {
      executeCommand(message.command, message.args)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error("Spotlight: command failed", err);
          sendResponse({ success: false, error: err?.message });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_NAVIGATE") {
      if (!navigation) {
        sendResponse({ success: false, error: "Navigation service unavailable" });
        return true;
      }
      navigation
        .navigateByDelta(message.tabId, message.delta)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error("Spotlight: navigation request failed", err);
          sendResponse({ success: false, error: err?.message });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_PERFORMANCE_SNAPSHOT") {
      if (!performanceTracker) {
        sendResponse({ success: false, error: "Performance tracker unavailable" });
        return true;
      }
      performanceTracker
        .captureSnapshot()
        .then((snapshot) => sendResponse({ success: true, snapshot }))
        .catch((err) => {
          console.error("Spotlight: performance snapshot failed", err);
          sendResponse({ success: false, error: err?.message || "Unable to capture snapshot" });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_DEBUG_ATTACH") {
      if (!devtools) {
        sendResponse({ success: false, error: "DevTools bridge unavailable" });
        return true;
      }
      devtools
        .attachToTab(message.tabId)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((err) => {
          console.error("Spotlight: failed to attach debugger", err);
          sendResponse({ success: false, error: err?.message || "Unable to attach" });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_DEBUG_DETACH") {
      if (!devtools) {
        sendResponse({ success: false, error: "DevTools bridge unavailable" });
        return true;
      }
      devtools
        .detachFromTab(message.tabId)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((err) => {
          console.warn("Spotlight: failed to detach debugger", err);
          sendResponse({ success: false, error: err?.message || "Unable to detach" });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_DEBUG_COMMAND") {
      if (!devtools) {
        sendResponse({ success: false, error: "DevTools bridge unavailable" });
        return true;
      }
      const method = typeof message.method === "string" ? message.method : "";
      const params = message.params && typeof message.params === "object" ? message.params : undefined;
      devtools
        .sendCommand(message.tabId, method, params)
        .then((result) => sendResponse({ success: true, result: result ?? null }))
        .catch((err) => {
          console.error("Spotlight: DevTools command failed", err);
          sendResponse({ success: false, error: err?.message || "Command failed" });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_FOCUS_TAB") {
      const tabId = typeof message.tabId === "number" ? message.tabId : null;
      const windowId = typeof message.windowId === "number" ? message.windowId : null;
      if (tabId === null) {
        sendResponse({ success: false, error: "Invalid tab id" });
        return true;
      }
      chrome.tabs
        .update(tabId, { active: true })
        .then(() => {
          if (windowId !== null) {
            return chrome.windows.update(windowId, { focused: true });
          }
          return null;
        })
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.warn("Spotlight: failed to focus tab", err);
          sendResponse({ success: false, error: err?.message || "Unable to focus tab" });
        });
      return true;
    }

    return undefined;
  });
}
