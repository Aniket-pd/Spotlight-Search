import "../shared/web-search.js";

function numberToHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function normalizeChromeThemeColor(color) {
  if (!color) {
    return null;
  }
  if (typeof color === "string") {
    const trimmed = color.trim();
    const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (match) {
      const value = match[1];
      if (value.length === 3) {
        return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`.toLowerCase();
      }
      return `#${value.toLowerCase()}`;
    }
    return null;
  }
  if (Array.isArray(color)) {
    const [r, g, b, a] = color;
    if ([r, g, b].every((value) => typeof value === "number")) {
      const alpha = typeof a === "number" ? a : 255;
      if (alpha <= 0) {
        return null;
      }
      const convert = (value) => (value > 1 ? value : value * 255);
      return `#${numberToHex(convert(r))}${numberToHex(convert(g))}${numberToHex(convert(b))}`;
    }
    return null;
  }
  if (typeof color === "object") {
    const r = color?.r;
    const g = color?.g;
    const b = color?.b;
    if ([r, g, b].every((value) => typeof value === "number")) {
      return `#${numberToHex(r)}${numberToHex(g)}${numberToHex(b)}`;
    }
  }
  return null;
}

function getStoredSpotlightTheme() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve(null);
      return;
    }
    chrome.storage.local.get({ spotlightTheme: null }, (items) => {
      if (chrome.runtime?.lastError) {
        resolve(null);
        return;
      }
      resolve(items?.spotlightTheme || null);
    });
  });
}

function setStoredSpotlightTheme(theme) {
  return new Promise((resolve, reject) => {
    if (!chrome?.storage?.local) {
      resolve();
      return;
    }
    chrome.storage.local.set({ spotlightTheme: theme }, () => {
      if (chrome.runtime?.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}

function getChromeThemePalette() {
  return new Promise((resolve) => {
    if (!chrome?.theme?.getCurrent) {
      resolve(null);
      return;
    }
    try {
      chrome.theme.getCurrent(null, (theme) => {
        if (chrome.runtime?.lastError) {
          resolve(null);
          return;
        }
        resolve(theme || null);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

export function registerMessageHandlers({
  context,
  runSearch,
  executeCommand,
  resolveFaviconForTarget,
  navigation,
  summaries,
  organizer,
  focus,
  historyAssistant,
}) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return undefined;
    }

    if (message.type === "SPOTLIGHT_THEME_REQUEST") {
      Promise.all([getStoredSpotlightTheme(), getChromeThemePalette()])
        .then(([storedTheme, chromeTheme]) => {
          let sourceColor = null;
          let mode = null;
          if (storedTheme && typeof storedTheme === "object") {
            mode = typeof storedTheme.mode === "string" ? storedTheme.mode : null;
            const storedColor = normalizeChromeThemeColor(storedTheme.sourceColor);
            if (storedColor) {
              sourceColor = storedColor;
            }
          }
          if (!sourceColor && chromeTheme && chromeTheme.colors) {
            const themeColors = chromeTheme.colors;
            const candidates = [
              themeColors.accentcolor,
              themeColors.frame,
              themeColors.toolbar,
              themeColors.button_background,
            ];
            for (const candidate of candidates) {
              const normalized = normalizeChromeThemeColor(candidate);
              if (normalized) {
                sourceColor = normalized;
                break;
              }
            }
          }
          sendResponse({ success: true, theme: { sourceColor, mode } });
        })
        .catch((err) => {
          console.warn("Spotlight: theme request failed", err);
          sendResponse({ success: false, theme: null });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_THEME_UPDATE") {
      const theme =
        message && typeof message.theme === "object" && message.theme
          ? {
              mode: message.theme.mode === "dark" || message.theme.mode === "light"
                ? message.theme.mode
                : undefined,
              sourceColor: normalizeChromeThemeColor(message.theme.sourceColor),
            }
          : {};
      setStoredSpotlightTheme(theme)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.warn("Spotlight: theme update failed", error);
          sendResponse({ success: false, error: error?.message || "Unable to store theme" });
        });
      return true;
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

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT") {
      if (!historyAssistant || typeof historyAssistant.analyzeHistoryRequest !== "function") {
        sendResponse({
          success: false,
          error: "History assistant unavailable",
          requestId: message.requestId,
        });
        return true;
      }
      const prompt = typeof message.prompt === "string" ? message.prompt.trim() : "";
      if (!prompt) {
        sendResponse({
          success: false,
          error: "Enter a request for the history assistant",
          requestId: message.requestId,
        });
        return true;
      }
      context
        .ensureIndex()
        .then((data) =>
          historyAssistant.analyzeHistoryRequest({ prompt, items: data?.items || [], now: Date.now() })
        )
        .then((result) => {
          sendResponse({ success: true, ...result, requestId: message.requestId });
        })
        .catch((err) => {
          const errorMessage = err?.message || "History assistant unavailable";
          console.warn("Spotlight: history assistant request failed", err);
          sendResponse({ success: false, error: errorMessage, requestId: message.requestId });
        });
      return true;
    }

    if (message.type === "SPOTLIGHT_HISTORY_ASSISTANT_ACTION") {
      if (!historyAssistant || typeof historyAssistant.executeAction !== "function") {
        sendResponse({ success: false, error: "History assistant unavailable" });
        return true;
      }
      context
        .ensureIndex()
        .then((data) =>
          historyAssistant.executeAction(message.action, message.itemIds, data?.items || [])
        )
        .then((result) => {
          sendResponse({ success: true, ...result });
        })
        .catch((err) => {
          const errorMessage = err?.message || "Unable to complete action";
          console.warn("Spotlight: history assistant action failed", err);
          sendResponse({ success: false, error: errorMessage });
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
