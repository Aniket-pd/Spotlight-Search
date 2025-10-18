const MAX_ENTRIES_PER_TAB = 50;

const tabHistories = new Map();

function isTrackableUrl(url) {
  if (!url) return false;
  return !url.startsWith("chrome://") && !url.startsWith("chrome-extension://");
}

function ensureHistory(tabId) {
  let history = tabHistories.get(tabId);
  if (!history) {
    history = { entries: [], currentIndex: -1 };
    tabHistories.set(tabId, history);
  }
  return history;
}

function trimHistory(history) {
  if (history.entries.length <= MAX_ENTRIES_PER_TAB) {
    return;
  }
  const excess = history.entries.length - MAX_ENTRIES_PER_TAB;
  history.entries.splice(0, excess);
  history.currentIndex = Math.max(0, history.currentIndex - excess);
}

function toEntry({ url = "", title = "", lastVisitTime = Date.now() }) {
  return {
    url,
    title: title || url,
    lastVisitTime,
  };
}

async function captureTabState(tab) {
  if (!tab || typeof tab.id !== "number" || !isTrackableUrl(tab.url || "")) {
    return;
  }
  const history = ensureHistory(tab.id);
  if (history.entries.length === 0) {
    history.entries.push(
      toEntry({
        url: tab.url,
        title: tab.title || tab.pendingUrl || tab.url,
        lastVisitTime: tab.lastAccessed || Date.now(),
      })
    );
    history.currentIndex = history.entries.length - 1;
  }
}

function cloneEntry(entry) {
  if (!entry) {
    return null;
  }
  return {
    url: entry.url,
    title: entry.title,
    lastVisitTime: entry.lastVisitTime,
  };
}

export function getTabNavigation(tabId) {
  const history = tabHistories.get(tabId);
  if (!history || history.entries.length === 0) {
    return { backStack: [], forwardStack: [], current: null };
  }

  const currentIndex = Math.min(
    Math.max(history.currentIndex, 0),
    history.entries.length - 1
  );
  const current = history.entries[currentIndex] || null;
  const backStack = history.entries.slice(0, currentIndex).reverse().map(cloneEntry);
  const forwardStack = history.entries
    .slice(currentIndex + 1)
    .map(cloneEntry);

  return {
    backStack,
    forwardStack,
    current: cloneEntry(current),
  };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabHistories.delete(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (tabHistories.has(removedTabId)) {
    const history = tabHistories.get(removedTabId);
    tabHistories.set(addedTabId, history);
    tabHistories.delete(removedTabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !isTrackableUrl(tab.url || "")) {
    return;
  }
  if (typeof changeInfo.title !== "string") {
    return;
  }
  const history = tabHistories.get(tabId);
  if (!history || history.currentIndex < 0) {
    return;
  }
  const current = history.entries[history.currentIndex];
  if (current && current.url === tab.url) {
    current.title = changeInfo.title || tab.title || current.title;
  }
});

if (chrome.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId !== 0) {
      return;
    }
    const tabId = details.tabId;
    if (typeof tabId !== "number" || tabId < 0) {
      return;
    }
    const url = details.url || "";
    if (!isTrackableUrl(url)) {
      return;
    }

    const history = ensureHistory(tabId);
    const timestamp = Date.now();
    let title = "";
    try {
      const tab = await chrome.tabs.get(tabId);
      title = tab?.title || tab?.pendingUrl || "";
    } catch (err) {
      // Ignore failures to retrieve tab state.
    }

    const isBackForward = Array.isArray(details.transitionQualifiers)
      ? details.transitionQualifiers.includes("forward_back")
      : false;

    if (isBackForward) {
      const index = history.entries.findIndex((entry) => entry.url === url);
      if (index >= 0) {
        history.currentIndex = index;
        history.entries[index].lastVisitTime = timestamp;
        if (title) {
          history.entries[index].title = title;
        }
        return;
      }
    }

    if (history.currentIndex >= 0 && history.currentIndex < history.entries.length - 1) {
      history.entries = history.entries.slice(0, history.currentIndex + 1);
    }

    history.entries.push(
      toEntry({
        url,
        title,
        lastVisitTime: timestamp,
      })
    );
    history.currentIndex = history.entries.length - 1;
    trimHistory(history);
  });
}

chrome.webNavigation.onHistoryStateUpdated?.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }
  const history = tabHistories.get(tabId);
  if (!history || history.currentIndex < 0) {
    return;
  }
  const current = history.entries[history.currentIndex];
  if (!current) {
    return;
  }
  const url = details.url || "";
  if (isTrackableUrl(url)) {
    current.url = url;
  }
});

async function primeExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      await captureTabState(tab);
    }
  } catch (err) {
    console.warn("Spotlight: failed to prime tab history", err);
  }
}

primeExistingTabs();
