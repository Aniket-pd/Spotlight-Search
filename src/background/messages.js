import "../shared/web-search.js";
import { analyzeQuery, createResultFromItem } from "../search/search.js";

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
      const queryString = typeof message.query === "string" ? message.query : "";
      const queryAnalysis = analyzeQuery(queryString);
      const requestTimestamp = Date.now();
      context
        .ensureIndex()
        .then(async (data) => {
          const payload =
            runSearch(queryString || "", data, {
              subfilter: message.subfilter,
              navigation: navigationState,
              webSearch: message.webSearch,
            }) || {};
          if (!payload.results || !Array.isArray(payload.results)) {
            payload.results = [];
          }

          const activeFilter = typeof payload.filter === "string" && payload.filter ? payload.filter : queryAnalysis.filterType;
          const assistantPrompt = queryAnalysis.trimmed || queryString.trim();
          if (
            historyAssistant &&
            typeof historyAssistant.processQuery === "function" &&
            activeFilter === "history" &&
            assistantPrompt
          ) {
            try {
              const assistantResult = await historyAssistant.processQuery({
                prompt: assistantPrompt,
                items: data.items,
                now: requestTimestamp,
              });
              if (assistantResult) {
                const assistantResults = Array.isArray(assistantResult.items)
                  ? assistantResult.items.map((item) => createResultFromItem(item)).filter(Boolean)
                  : [];
                payload.results = assistantResults;
                payload.ghost = null;
                payload.answer = "";
                payload.webSearch = undefined;
                payload.assistant = {
                  message: typeof assistantResult.message === "string" ? assistantResult.message : "",
                  action: assistantResult.action || "show",
                  itemIds: Array.isArray(assistantResult.itemIds) ? assistantResult.itemIds : undefined,
                  rangeLabel:
                    typeof assistantResult.rangeLabel === "string" && assistantResult.rangeLabel
                      ? assistantResult.rangeLabel
                      : undefined,
                  timeRange: assistantResult.timeRange || undefined,
                };
              }
            } catch (error) {
              console.warn("Spotlight: history assistant failed", error);
            }
          }

          sendResponse({ ...payload, requestId: message.requestId });
        })
        .catch((err) => {
          console.error("Spotlight: query failed", err);
          sendResponse({ results: [], error: true, requestId: message.requestId });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_DELETE") {
      const rawIds = Array.isArray(message.itemIds) ? message.itemIds : [];
      const itemIds = rawIds
        .map((value) => Number(value))
        .filter((value, index, list) => Number.isInteger(value) && value >= 0 && list.indexOf(value) === index);
      if (!itemIds.length) {
        sendResponse({ success: false, error: "No history items specified" });
        return true;
      }
      context
        .ensureIndex()
        .then(async (data) => {
          const items = itemIds
            .map((id) => data.items?.[id])
            .filter((item) => item && item.type === "history" && typeof item.url === "string" && item.url);
          if (!items.length) {
            sendResponse({ success: false, error: "History entries not found" });
            return;
          }
          const urls = Array.from(new Set(items.map((item) => item.url)));
          const results = await Promise.allSettled(
            urls.map((url) =>
              chrome.history
                .deleteUrl({ url })
                .catch((error) => {
                  console.warn("Spotlight: failed to delete history url", url, error);
                  throw error;
                })
            )
          );
          if (typeof context.scheduleRebuild === "function") {
            context.scheduleRebuild(500);
          }
          const failures = results.filter((entry) => entry.status === "rejected");
          if (failures.length) {
            sendResponse({ success: false, deleted: items.map((item) => item.id) });
            return;
          }
          sendResponse({ success: true, deleted: items.map((item) => item.id) });
        })
        .catch((error) => {
          console.error("Spotlight: history delete failed", error);
          sendResponse({ success: false, error: error?.message || "Unable to delete history" });
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
