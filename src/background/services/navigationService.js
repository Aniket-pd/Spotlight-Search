import { ensureIndex } from "./indexService.js";
import { getOriginFromUrl, isHttpUrl } from "../../common/urls.js";

const MAX_STACK_SIZE = 25;

const navigationStates = new Map();
let trackingInitialized = false;

function now() {
  return Date.now();
}

function createEntry(url, title = "", origin) {
  if (!url) {
    return null;
  }
  const normalizedTitle = typeof title === "string" && title.trim() ? title.trim() : "";
  return {
    url,
    title: normalizedTitle || url,
    origin: origin || getOriginFromUrl(url) || "",
    timestamp: now(),
  };
}

function getState(tabId) {
  let state = navigationStates.get(tabId);
  if (!state) {
    state = { current: null, back: [], forward: [] };
    navigationStates.set(tabId, state);
  }
  return state;
}

function dedupeStack(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (!entry || !entry.url) {
      continue;
    }
    if (seen.has(entry.url)) {
      continue;
    }
    seen.add(entry.url);
    result.push(entry);
    if (result.length >= MAX_STACK_SIZE) {
      break;
    }
  }
  return result;
}

function mergeTitle(target, title) {
  if (!target || typeof title !== "string") {
    return target;
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return target;
  }
  return { ...target, title: trimmed };
}

function updateCurrentEntry(tabId, nextEntry) {
  const state = getState(tabId);
  if (!nextEntry) {
    state.current = null;
    state.back = [];
    state.forward = [];
    return;
  }

  const previous = state.current;
  if (!previous) {
    state.current = nextEntry;
    return;
  }

  if (previous.url === nextEntry.url) {
    state.current = mergeTitle({ ...previous, timestamp: now() }, nextEntry.title);
    return;
  }

  const backTop = state.back[0];
  const forwardTop = state.forward[0];

  if (backTop && backTop.url === nextEntry.url) {
    state.forward = dedupeStack([{ ...previous, timestamp: now() }, ...state.forward]);
    state.back = dedupeStack(state.back.slice(1));
  } else if (forwardTop && forwardTop.url === nextEntry.url) {
    state.back = dedupeStack([{ ...previous, timestamp: now() }, ...state.back]);
    state.forward = dedupeStack(state.forward.slice(1));
  } else {
    state.back = dedupeStack([{ ...previous, timestamp: now() }, ...state.back]);
    state.forward = [];
  }

  state.current = nextEntry;
}

function handleUrlChange(tabId, url, tab) {
  if (!url) {
    return;
  }
  if (!isHttpUrl(url)) {
    const entry = createEntry(url, tab?.title || url, getOriginFromUrl(url));
    updateCurrentEntry(tabId, entry);
    return;
  }

  const title = tab?.title || "";
  const entry = createEntry(url, title, getOriginFromUrl(url));
  if (entry) {
    updateCurrentEntry(tabId, entry);
  }
}

function handleTitleChange(tabId, title) {
  const state = getState(tabId);
  if (!state.current || typeof title !== "string") {
    return;
  }
  state.current = mergeTitle(state.current, title);
}

async function primeState() {
  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((tab) => {
      if (!tab || tab.id === undefined || !tab.url) {
        return;
      }
      handleUrlChange(tab.id, tab.url, tab);
      if (tab.title) {
        handleTitleChange(tab.id, tab.title);
      }
    });
  } catch (err) {
    console.warn("Spotlight: unable to prime navigation state", err);
  }
}

function normalizeQuery(query) {
  return typeof query === "string" ? query.trim().toLowerCase() : "";
}

function matchesQuery(entry, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }
  const title = entry?.title?.toLowerCase?.() || "";
  const url = entry?.url?.toLowerCase?.() || "";
  return title.includes(normalizedQuery) || url.includes(normalizedQuery);
}

export function setupNavigationTracking() {
  if (trackingInitialized) {
    return;
  }
  trackingInitialized = true;

  primeState();

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      handleUrlChange(tabId, changeInfo.url, tab);
    }
    if (changeInfo.title) {
      handleTitleChange(tabId, changeInfo.title);
    }
    if (!changeInfo.url && tab?.url && !getState(tabId).current) {
      handleUrlChange(tabId, tab.url, tab);
      if (tab.title) {
        handleTitleChange(tabId, tab.title);
      }
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    navigationStates.delete(tabId);
  });

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    const existing = navigationStates.get(removedTabId);
    if (existing) {
      navigationStates.set(addedTabId, existing);
    }
    navigationStates.delete(removedTabId);
  });
}

export async function getNavigationResults(direction = "back", query = "") {
  const normalizedDirection = direction === "forward" ? "forward" : "back";
  const normalizedQuery = normalizeQuery(query);

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || activeTab.id === undefined) {
      return { results: [], filter: normalizedDirection, navigation: { direction: normalizedDirection } };
    }

    if (activeTab.url) {
      handleUrlChange(activeTab.id, activeTab.url, activeTab);
      if (activeTab.title) {
        handleTitleChange(activeTab.id, activeTab.title);
      }
    }

    const state = getState(activeTab.id);
    const stack = normalizedDirection === "forward" ? state.forward : state.back;
    const entries = Array.isArray(stack) ? stack.filter((entry) => matchesQuery(entry, normalizedQuery)) : [];

    let indexData = null;
    try {
      indexData = await ensureIndex();
    } catch (err) {
      console.warn("Spotlight: unable to access index for navigation results", err);
    }

    const urlToItem = new Map();
    if (indexData && Array.isArray(indexData.items)) {
      indexData.items.forEach((item) => {
        if (!item || !item.url || urlToItem.has(item.url)) {
          return;
        }
        urlToItem.set(item.url, item);
      });
    }

    const results = entries.map((entry, index) => {
      const matched = entry.url ? urlToItem.get(entry.url) : null;
      const title = entry.title || matched?.title || entry.url || "";
      const description = matched?.description || matched?.url || entry.url || "";
      const origin = entry.origin || matched?.origin || getOriginFromUrl(entry.url);
      const type = matched?.type === "tab" ? "tab" : matched?.type === "bookmark" ? "bookmark" : "navigation";
      return {
        id: `navigation:${normalizedDirection}:${index}:${entry.url || index}`,
        type,
        title,
        url: entry.url,
        description,
        origin,
        navigation: {
          direction: normalizedDirection,
          url: entry.url,
        },
      };
    });

    return {
      results,
      filter: normalizedDirection,
      navigation: { direction: normalizedDirection },
    };
  } catch (err) {
    console.warn("Spotlight: failed to compute navigation results", err);
    return { results: [], filter: normalizedDirection, navigation: { direction: normalizedDirection } };
  }
}

export async function navigateToHistoryTarget(url) {
  if (!url) {
    throw new Error("Invalid navigation target");
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || activeTab.id === undefined) {
    throw new Error("No active tab to navigate");
  }
  await chrome.tabs.update(activeTab.id, { url });
}
