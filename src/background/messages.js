import {
  matchesTabPerformanceQuery,
  getTabPerformanceSnapshot,
  TAB_PERFORMANCE_REFRESH_INTERVAL,
} from "./performance.js";

export function registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  tabActions,
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

      if (matchesTabPerformanceQuery(message.query || "")) {
        getTabPerformanceSnapshot()
          .then(({ results, answer }) => {
            sendResponse({
              results,
              ghost: null,
              answer: answer || "Live tab performance",
              filter: "tabPerformance",
              requestId: message.requestId,
              refreshInterval: TAB_PERFORMANCE_REFRESH_INTERVAL,
            });
          })
          .catch((err) => {
            console.warn("Spotlight: performance snapshot failed", err);
            sendResponse({
              results: [],
              ghost: null,
              answer: "",
              filter: "tabPerformance",
              requestId: message.requestId,
              refreshInterval: TAB_PERFORMANCE_REFRESH_INTERVAL,
              error: true,
            });
          });
        return true;
      }

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

    if (message.type === "SPOTLIGHT_ACTIVATE_TAB") {
      if (!tabActions || typeof tabActions.activateTab !== "function") {
        sendResponse({ success: false, error: "Tab activation unavailable" });
        return true;
      }
      tabActions
        .activateTab(message.tabId)
        .then((success) => sendResponse({ success: Boolean(success) }))
        .catch((err) => {
          console.warn("Spotlight: activate tab failed", err);
          sendResponse({ success: false, error: err?.message });
        });
      return true;
    }

    return undefined;
  });
}
