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
  historySummaries,
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

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT") {
      if (!historyAssistant || typeof historyAssistant.interpret !== "function") {
        sendResponse({ success: false, error: "Smart history assistant unavailable" });
        return true;
      }
      historyAssistant
        .interpret({ text: message.text || message.query || "" })
        .then((plan) => {
          sendResponse({ success: true, plan });
        })
        .catch((error) => {
          const errorMessage = error?.message || "Assistant request failed";
          sendResponse({ success: false, error: errorMessage });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT_SUMMARIZE") {
      if (!historySummaries || typeof historySummaries.summarize !== "function") {
        sendResponse({ success: false, error: "History summaries unavailable" });
        return true;
      }
      const entries = Array.isArray(message.entries) ? message.entries : [];
      const timeRange = message.timeRange && typeof message.timeRange === "object" ? message.timeRange : null;
      const timeRangeLabel = typeof message.timeRangeLabel === "string" ? message.timeRangeLabel : "";
      const totalCount = Number.isFinite(message.totalCount) ? message.totalCount : null;
      const query = typeof message.query === "string" ? message.query : "";
      const topic = typeof message.topic === "string" ? message.topic : "";
      const site = typeof message.site === "string" ? message.site : "";
      const planMessage = typeof message.planMessage === "string" ? message.planMessage : "";
      const tone = typeof message.tone === "string" ? message.tone : "";
      const context = message.context && typeof message.context === "object" ? message.context : null;
      const comparison = message.comparison && typeof message.comparison === "object" ? message.comparison : null;

      const handleError = (error) => {
        const errorMessage = error?.message || "Unable to summarize history";
        sendResponse({ success: false, error: errorMessage });
      };

      let summaryPromise;
      try {
        summaryPromise = historySummaries.summarize({
          entries,
          timeRange,
          timeRangeLabel,
          totalCount,
          query,
          topic,
          site,
          planMessage,
          tone,
          context,
          comparison,
        });
      } catch (error) {
        handleError(error);
        return true;
      }

      Promise.resolve(summaryPromise)
        .then((summary) => {
          sendResponse({ success: true, summary });
        })
        .catch(handleError);
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_DELETE") {
      const urls = Array.isArray(message.urls)
        ? message.urls.map((url) => (typeof url === "string" ? url.trim() : "")).filter(Boolean)
        : [];
      if (!urls.length) {
        sendResponse({ success: false, error: "No history URLs provided" });
        return true;
      }
      Promise.all(urls.map((url) => chrome.history.deleteUrl({ url })))
        .then(() => {
          if (context && typeof context.scheduleRebuild === "function") {
            context.scheduleRebuild(400);
          }
          sendResponse({ success: true, count: urls.length });
        })
        .catch((error) => {
          console.error("Spotlight: failed to delete history entries", error);
          sendResponse({ success: false, error: error?.message || "Failed to delete history" });
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
