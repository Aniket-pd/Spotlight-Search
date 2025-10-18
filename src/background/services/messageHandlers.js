import { ensureIndex, rebuildIndex } from "./indexService.js";
import { executeCommand } from "./commandService.js";
import { resolveFaviconForTarget } from "./faviconService.js";
import { getNavigationResults, navigateToHistoryTarget } from "./navigationService.js";
import { runSearch } from "../../search/searchEngine.js";

export function createMessageHandler() {
  return (message, sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    switch (message.type) {
      case "SPOTLIGHT_QUERY":
        ensureIndex()
          .then((data) => {
            const payload = runSearch(message.query || "", data, { subfilter: message.subfilter }) || {};
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

      case "SPOTLIGHT_NAVIGATION":
        getNavigationResults(message.direction, message.query)
          .then((payload) => {
            const results = Array.isArray(payload?.results) ? payload.results : [];
            const filter = typeof payload?.filter === "string" ? payload.filter : null;
            const response = {
              results,
              filter,
              navigation: payload?.navigation || { direction: message.direction || "back" },
              requestId: message.requestId,
            };
            sendResponse(response);
          })
          .catch((err) => {
            console.error("Spotlight: navigation query failed", err);
            sendResponse({ results: [], filter: message.direction || "back", navigation: { direction: message.direction || "back" }, requestId: message.requestId, error: true });
          });
        return true;

      case "SPOTLIGHT_FAVICON":
        ensureIndex()
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

      case "SPOTLIGHT_OPEN":
        ensureIndex()
          .then((data) => {
            const item = data.items?.[message.itemId];
            if (!item) {
              throw new Error("Item not found");
            }
            return openItem(item);
          })
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            console.error("Spotlight: open failed", err);
            sendResponse({ success: false, error: err?.message });
          });
        return true;

      case "SPOTLIGHT_NAVIGATE":
        navigateToHistoryTarget(message.url)
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            console.error("Spotlight: navigation failed", err);
            sendResponse({ success: false, error: err?.message });
          });
        return true;

      case "SPOTLIGHT_REINDEX":
        rebuildIndex()
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            console.error("Spotlight: reindex failed", err);
            sendResponse({ success: false, error: err?.message });
          });
        return true;

      case "SPOTLIGHT_COMMAND":
        executeCommand(message.command, message.args)
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            console.error("Spotlight: command failed", err);
            sendResponse({ success: false, error: err?.message });
          });
        return true;

      default:
        return false;
    }
  };
}

async function openItem(item) {
  if (!item) {
    throw new Error("Item not found");
  }

  if (item.type === "tab" && item.tabId !== undefined) {
    try {
      await chrome.tabs.update(item.tabId, { active: true });
      if (item.windowId !== undefined) {
        await chrome.windows.update(item.windowId, { focused: true });
      }
      return;
    } catch (err) {
      console.warn("Spotlight: failed to focus tab, opening new tab instead", err);
    }
  }

  if (item.url) {
    await chrome.tabs.create({ url: item.url });
  } else {
    throw new Error("Item has no URL");
  }
}
