import "../shared/web-search.js";

export function registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  summaries,
  organizer,
  historyAssistant,
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
      chrome.tabs
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

    if (message.type === "SPOTLIGHT_SUMMARIZE") {
      if (!summaries || typeof summaries.requestSummary !== "function") {
        sendResponse({ success: false, error: "Summaries unavailable" });
        return true;
      }
      const url = typeof message.url === "string" ? message.url : "";
      if (!url) {
        sendResponse({ success: false, error: "Missing URL for summary" });
        return true;
      }
      const tabId = typeof message.tabId === "number" ? message.tabId : null;
      const requestId =
        typeof message.summaryRequestId === "number" && Number.isFinite(message.summaryRequestId)
          ? message.summaryRequestId
          : null;
      const requesterTabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
      const notifyProgress = (update) => {
        if (requestId === null || requesterTabId === null) {
          return;
        }
        const payload = {
          type: "SPOTLIGHT_SUMMARY_PROGRESS",
          url,
          requestId,
          bullets: Array.isArray(update?.bullets) ? update.bullets.filter(Boolean).slice(0, 3) : undefined,
          raw: typeof update?.raw === "string" ? update.raw : undefined,
          cached: Boolean(update?.cached),
          source: typeof update?.source === "string" ? update.source : undefined,
          done: Boolean(update?.done),
        };
        try {
          const maybePromise = chrome.tabs.sendMessage(requesterTabId, payload);
          if (maybePromise && typeof maybePromise.catch === "function") {
            maybePromise.catch((error) => {
              console.warn("Spotlight: failed to post summary progress", error);
            });
          }
        } catch (err) {
          console.warn("Spotlight: summary progress dispatch failed", err);
        }
      };
      summaries
        .requestSummary({ url, tabId, onProgress: notifyProgress })
        .then((result) => {
          sendResponse({ success: true, ...result });
        })
        .catch((err) => {
          console.error("Spotlight: summary generation failed", err);
          const errorMessage = err?.message || "Unable to generate summary";
          sendResponse({ success: false, error: errorMessage });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT_QUERY") {
      if (!historyAssistant || typeof historyAssistant.analyze !== "function") {
        sendResponse({ success: false, error: "History assistant unavailable" });
        return true;
      }
      const query = typeof message.query === "string" ? message.query.trim() : "";
      if (!query) {
        sendResponse({ success: false, error: "Empty request" });
        return true;
      }
      const contextPayload = message.context && typeof message.context === "object" ? message.context : {};
      historyAssistant
        .analyze({ query, context: contextPayload })
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          console.error("Spotlight: history assistant query failed", error);
          const errorMessage = error?.message || "History assistant unavailable";
          sendResponse({ success: false, error: errorMessage });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT_EXECUTE") {
      if (!historyAssistant || typeof historyAssistant.execute !== "function") {
        sendResponse({ success: false, error: "History assistant unavailable" });
        return true;
      }
      historyAssistant
        .execute({
          requestToken: typeof message.requestToken === "string" ? message.requestToken : "",
          action: typeof message.action === "string" ? message.action : "",
          groupId: typeof message.groupId === "string" ? message.groupId : "",
          entryIds: Array.isArray(message.entryIds) ? message.entryIds : [],
        })
        .then((result) => {
          sendResponse({ success: true, ...result });
        })
        .catch((error) => {
          console.error("Spotlight: history assistant action failed", error);
          const errorMessage = error?.message || "Unable to complete action";
          sendResponse({ success: false, error: errorMessage });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT_UNDO") {
      if (!historyAssistant || typeof historyAssistant.undoDeletion !== "function") {
        sendResponse({ success: false, error: "History assistant unavailable" });
        return true;
      }
      historyAssistant
        .undoDeletion()
        .then((result) => {
          sendResponse({ success: true, ...result });
        })
        .catch((error) => {
          console.error("Spotlight: history assistant undo failed", error);
          const errorMessage = error?.message || "Nothing to undo";
          sendResponse({ success: false, error: errorMessage });
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
