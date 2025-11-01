import { browser, supportsScripting, supportsWebNavigation } from "../shared/browser-shim.js";

const MAX_HISTORY_ENTRIES = 60;

function isValidUrl(url) {
  if (!url) return false;
  if (/^chrome(|-extension):\/\//i.test(url)) {
    return false;
  }
  return true;
}

function createNavigationEntry({ url = "", title = "", timeStamp = Date.now(), faviconUrl = "" }) {
  return {
    url,
    title: title || url || "Untitled",
    timeStamp,
    faviconUrl: faviconUrl || "",
  };
}

function normalizeStack(history) {
  if (!history) return;
  if (history.index >= history.stack.length) {
    history.index = history.stack.length - 1;
  }
  if (history.index < 0 && history.stack.length) {
    history.index = history.stack.length - 1;
  }
  if (history.index < 0) {
    history.index = -1;
  }
}

async function queryTab(tabId) {
  try {
    return await browser.tabs.get(tabId);
  } catch (err) {
    return null;
  }
}

export function createNavigationService() {
  const histories = new Map();

  function ensureHistory(tabId) {
    if (typeof tabId !== "number" || tabId < 0) {
      return null;
    }
    let entry = histories.get(tabId);
    if (!entry) {
      entry = { tabId, stack: [], index: -1 };
      histories.set(tabId, entry);
    }
    return entry;
  }

  function trimHistory(history) {
    if (!history) return;
    if (history.stack.length > MAX_HISTORY_ENTRIES) {
      const excess = history.stack.length - MAX_HISTORY_ENTRIES;
      history.stack.splice(0, excess);
      history.index -= excess;
      if (history.index < 0) {
        history.index = history.stack.length ? 0 : -1;
      }
    }
  }

  function updateCurrentMetadata(tabId, tab) {
    if (!tab) return;
    const history = histories.get(tabId);
    if (!history || history.index < 0 || history.index >= history.stack.length) {
      return;
    }
    const current = history.stack[history.index];
    if (!current) return;
    if (tab.url && tab.url !== current.url && tab.pendingUrl !== current.url) {
      return;
    }
    if (tab.title) {
      current.title = tab.title;
    }
    if (tab.favIconUrl) {
      current.faviconUrl = tab.favIconUrl;
    }
  }

  function findMatchingIndex(stack, url) {
    if (!Array.isArray(stack) || !url) {
      return -1;
    }
    for (let i = 0; i < stack.length; i += 1) {
      if (stack[i] && stack[i].url === url) {
        return i;
      }
    }
    return -1;
  }

  async function handleNavigation(details) {
    if (!details) return;
    const { tabId, frameId, url, timeStamp, transitionQualifiers = [] } = details;
    if (typeof tabId !== "number" || tabId < 0) {
      return;
    }
    if (frameId !== 0) {
      return;
    }
    if (!isValidUrl(url)) {
      return;
    }

    const history = ensureHistory(tabId);
    if (!history) return;

    const isForwardBack = transitionQualifiers.includes("forward_back");

    if (isForwardBack && history.stack.length) {
      const matchIndex = findMatchingIndex(history.stack, url);
      if (matchIndex !== -1) {
        history.index = matchIndex;
        const tab = await queryTab(tabId);
        if (tab) {
          updateCurrentMetadata(tabId, tab);
        }
        return;
      }
    }

    if (history.index < history.stack.length - 1) {
      history.stack = history.stack.slice(0, history.index + 1);
    }

    const entry = createNavigationEntry({ url, title: "", timeStamp });
    history.stack.push(entry);
    history.index = history.stack.length - 1;
    trimHistory(history);
    normalizeStack(history);

    const tab = await queryTab(tabId);
    if (tab) {
      updateCurrentMetadata(tabId, tab);
      const current = history.stack[history.index];
      if (current) {
        if (!current.title && tab.title) {
          current.title = tab.title;
        }
        if (!current.faviconUrl && tab.favIconUrl) {
          current.faviconUrl = tab.favIconUrl;
        }
      }
    }
  }

  async function bootstrap() {
    try {
      const tabs = await browser.tabs.query({});
      const now = Date.now();
      for (const tab of tabs) {
        if (typeof tab.id !== "number" || tab.id < 0) {
          continue;
        }
        if (!isValidUrl(tab.url)) {
          continue;
        }
        const history = ensureHistory(tab.id);
        history.stack = [
          createNavigationEntry({
            url: tab.url,
            title: tab.title || tab.url || "Untitled",
            timeStamp: tab.lastAccessed || now,
            faviconUrl: tab.favIconUrl || "",
          }),
        ];
        history.index = 0;
      }
    } catch (err) {
      console.warn("Spotlight: failed to bootstrap navigation history", err);
    }
  }

  function handleTabUpdated(tabId, changeInfo, tab) {
    if (!changeInfo) {
      return;
    }

    if (changeInfo.title || changeInfo.favIconUrl) {
      updateCurrentMetadata(tabId, tab || null);
    }
  }

  function handleTabRemoved(tabId) {
    histories.delete(tabId);
  }

  function handleTabReplaced(addedTabId, removedTabId) {
    if (typeof removedTabId !== "number" || removedTabId < 0) {
      return;
    }
    const existing = histories.get(removedTabId);
    if (!existing) {
      return;
    }
    histories.delete(removedTabId);
    existing.tabId = addedTabId;
    histories.set(addedTabId, existing);
  }

  function buildNavigationResults({ tabId, direction }) {
    const history = histories.get(tabId);
    if (!history || !history.stack.length || history.index < 0) {
      return [];
    }
    const results = [];
    if (direction === "back") {
      for (let i = history.index - 1; i >= 0; i -= 1) {
        const entry = history.stack[i];
        if (!entry) continue;
        results.push({
          ...entry,
          delta: i - history.index,
        });
      }
    } else {
      for (let i = history.index + 1; i < history.stack.length; i += 1) {
        const entry = history.stack[i];
        if (!entry) continue;
        results.push({
          ...entry,
          delta: i - history.index,
        });
      }
    }
    return results;
  }

  function getStateForTab(tabId) {
    if (typeof tabId !== "number" || tabId < 0) {
      return { tabId: null, back: [], forward: [] };
    }
    const back = buildNavigationResults({ tabId, direction: "back" });
    const forward = buildNavigationResults({ tabId, direction: "forward" });
    const limitBack = back.slice(0, 30);
    const limitForward = forward.slice(0, 30);
    return {
      tabId,
      back: limitBack,
      forward: limitForward,
    };
  }

  async function navigateByDelta(tabId, delta) {
    if (typeof tabId !== "number" || tabId < 0) {
      throw new Error("Invalid tabId");
    }
    const step = Number(delta);
    if (!Number.isFinite(step) || step === 0) {
      throw new Error("Invalid navigation delta");
    }
    if (supportsScripting()) {
      await browser.scripting.executeScript({
        target: { tabId },
        func: (offset) => {
          try {
            window.history.go(offset);
          } catch (err) {
            console.warn("Spotlight: navigation failed", err);
          }
        },
        args: [step],
      });
      return;
    }

    await browser.tabs.sendMessage(tabId, { type: "SPOTLIGHT_HISTORY_GO", delta: step });
  }

  return {
    ensureHistory,
    handleNavigation,
    handleTabUpdated,
    handleTabRemoved,
    handleTabReplaced,
    bootstrap,
    getStateForTab,
    navigateByDelta,
  };
}

export function registerNavigationListeners(service) {
  const handleNavigation = (details) => {
    service.handleNavigation(details).catch?.((err) => {
      console.warn("Spotlight: failed to record navigation", err);
    });
  };
  const useWebNavigation = supportsWebNavigation();

  if (useWebNavigation) {
    browser.webNavigation.onCommitted.addListener(handleNavigation);
    browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation);
  } else {
    browser.tabs?.onActivated?.addListener(async ({ tabId }) => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab && isValidUrl(tab.url)) {
          await service.handleNavigation({
            tabId,
            frameId: 0,
            url: tab.url,
            timeStamp: Date.now(),
            transitionQualifiers: [],
          });
        }
      } catch (err) {
        console.warn("Spotlight: failed to track activated tab navigation", err);
      }
    });
  }

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    try {
      service.handleTabUpdated(tabId, changeInfo, tab);
    } catch (err) {
      console.warn("Spotlight: failed to process tab update", err);
    }
    if (!useWebNavigation && changeInfo?.status === "complete" && tab && isValidUrl(tab.url)) {
      service
        .handleNavigation({
          tabId,
          frameId: 0,
          url: tab.url,
          timeStamp: Date.now(),
          transitionQualifiers: [],
        })
        .catch((err) => {
          console.warn("Spotlight: failed to record tab update navigation", err);
        });
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    try {
      service.handleTabRemoved(tabId);
    } catch (err) {
      console.warn("Spotlight: failed to process tab removal", err);
    }
  });
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    try {
      service.handleTabReplaced(addedTabId, removedTabId);
    } catch (err) {
      console.warn("Spotlight: failed to process tab replacement", err);
    }
  });
  service.bootstrap().catch((err) => {
    console.warn("Spotlight: failed to bootstrap navigation state", err);
  });
}
