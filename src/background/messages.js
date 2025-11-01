import { browser } from "../shared/browser-shim.js";
import "../shared/web-search.js";

export function registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  organizer,
  focus,
}) {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
              webSearch: message.webSearch,
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

    if (message.type === "SPOTLIGHT_FOCUS_STATUS_REQUEST") {
      const tabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
      const respond = (payload) => {
        try {
          sendResponse(payload);
        } catch (err) {
          console.warn("Spotlight: focus status response failed", err);
        }
      };

      if (!focus || typeof focus.getState !== "function") {
        respond({ focused: false });
        return true;
      }

      focus
        .getState()
        .then((state) => {
          if (!state || tabId === null || state.tabId !== tabId) {
            respond({ focused: false });
            return;
          }
          respond({
            focused: true,
            accentColor: focus.getAccentColor ? focus.getAccentColor() : undefined,
            titlePrefix: focus.getTitlePrefix ? focus.getTitlePrefix() : undefined,
            label: focus.getLabel ? focus.getLabel() : undefined,
          });
        })
        .catch((err) => {
          console.warn("Spotlight: focus status lookup failed", err);
          respond({ focused: false });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_WEB_SEARCH") {
      const api = typeof globalThis !== "undefined" ? globalThis.SpotlightWebSearch : null;
      const query = typeof message.query === "string" ? message.query.trim() : "";
      if (!api || typeof api.buildSearchUrl !== "function" || !query) {
        sendResponse({ success: false, error: "Web search unavailable" });
        return true;
      }
      const engineId = typeof message.engineId === "string" ? message.engineId : null;
      const url = api.buildSearchUrl(engineId, query);
      if (!url) {
        sendResponse({ success: false, error: "Web search unavailable" });
        return true;
      }
      browser.tabs
        .create({ url })
        .then(() => sendResponse({ success: true, url }))
        .catch((err) => {
          console.error("Spotlight: web search open failed", err);
          sendResponse({ success: false, error: err?.message || "Unable to open web search" });
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

    if (message.type === "SPOTLIGHT_BOOKMARK_ORGANIZE") {
      if (!organizer || typeof organizer.organizeBookmarks !== "function") {
        sendResponse({ success: false, error: "Bookmark organizer unavailable" });
        return true;
      }
      const limit = Number.isFinite(message.limit) ? message.limit : undefined;
      const language = typeof message.language === "string" ? message.language : undefined;
      const options = {};
      if (Number.isFinite(limit) && limit > 0) {
        options.limit = limit;
      }
      if (language) {
        options.language = language;
      }
      organizer
        .organizeBookmarks(options)
        .then((report) => {
          const response = {
            success: true,
            generatedAt: report.generatedAt,
            language: report.payload?.language,
            bookmarkCount: report.payload?.bookmarks?.length || 0,
            result: report.result,
            changes: report.changes || { renamed: 0, moved: 0, createdFolders: 0 },
          };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Spotlight: bookmark organizer failed", error);
          sendResponse({ success: false, error: error?.message || "Unable to organize bookmarks" });
        });
      return true;
    }

    return undefined;
  });
}
