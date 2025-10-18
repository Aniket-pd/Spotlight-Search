const MAX_NAV_ENTRIES = 40;

function isTrackableUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  if (/^chrome(|-extension):/i.test(url)) {
    return false;
  }
  if (/^about:/i.test(url)) {
    return false;
  }
  if (/^edge:/i.test(url)) {
    return false;
  }
  return true;
}

function createEntry(url, title) {
  return {
    url,
    title: title || url,
    time: Date.now(),
    entryId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

function cloneEntry(entry) {
  return {
    entryId: entry.entryId,
    url: entry.url,
    title: entry.title,
    time: entry.time,
  };
}

export function createNavigationTracker() {
  const tabRecords = new Map();
  let initialized = false;

  function ensureRecord(tabId) {
    if (!tabRecords.has(tabId)) {
      tabRecords.set(tabId, { entries: [], index: -1 });
    }
    return tabRecords.get(tabId);
  }

  function trimRecord(record) {
    if (!record || record.entries.length <= MAX_NAV_ENTRIES) {
      return;
    }
    const excess = record.entries.length - MAX_NAV_ENTRIES;
    record.entries.splice(0, excess);
    record.index = Math.max(record.index - excess, record.entries.length - 1);
  }

  function updateCurrentMetadata(tabId, updater) {
    const record = tabRecords.get(tabId);
    if (!record || record.index < 0 || record.index >= record.entries.length) {
      return;
    }
    const current = record.entries[record.index];
    if (!current) return;
    const next = updater(current);
    if (next && next !== current) {
      record.entries[record.index] = next;
    }
  }

  function handleNavigation(tabId, url, options = {}) {
    if (!isTrackableUrl(url)) {
      return;
    }
    const record = ensureRecord(tabId);
    const now = Date.now();
    const treatAsHistory = Boolean(options.historyMove);

    if (treatAsHistory && record.entries.length) {
      const prevEntry = record.index > 0 ? record.entries[record.index - 1] : null;
      const nextEntry = record.index >= 0 && record.index < record.entries.length - 1
        ? record.entries[record.index + 1]
        : null;
      if (prevEntry && prevEntry.url === url) {
        record.index -= 1;
        record.entries[record.index].time = now;
        return;
      }
      if (nextEntry && nextEntry.url === url) {
        record.index += 1;
        record.entries[record.index].time = now;
        return;
      }
    }

    const currentEntry = record.index >= 0 ? record.entries[record.index] : null;
    if (!treatAsHistory && currentEntry && currentEntry.url === url) {
      currentEntry.time = now;
      return;
    }

    if (record.index < record.entries.length - 1) {
      record.entries = record.entries.slice(0, record.index + 1);
    }

    const entry = createEntry(url);
    entry.time = now;
    record.entries.push(entry);
    record.index = record.entries.length - 1;
    trimRecord(record);
  }

  function syncWithTab(tab) {
    if (!tab || tab.id === undefined || !isTrackableUrl(tab.url)) {
      return;
    }
    const record = ensureRecord(tab.id);
    if (!record.entries.length) {
      record.entries.push(createEntry(tab.url, tab.title || tab.url));
      record.index = record.entries.length - 1;
      return;
    }
    const current = record.entries[record.index] || null;
    if (!current || current.url !== tab.url) {
      handleNavigation(tab.id, tab.url);
    }
    updateCurrentMetadata(tab.id, (entry) => ({ ...entry, title: tab.title || entry.title, url: tab.url || entry.url }));
  }

  function registerListeners() {
    if (initialized) {
      return;
    }
    initialized = true;

    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0 || details.tabId === undefined) {
        return;
      }
      handleNavigation(details.tabId, details.url, {
        historyMove: Array.isArray(details.transitionQualifiers)
          ? details.transitionQualifiers.includes("forward_back")
          : false,
      });
      updateCurrentMetadata(details.tabId, (entry) => ({ ...entry, url: details.url, time: Date.now() }));
      chrome.tabs.get(details.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          return;
        }
        syncWithTab(tab);
      });
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab || tab.id === undefined) {
        return;
      }
      if (changeInfo.title || changeInfo.url) {
        syncWithTab(tab);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      tabRecords.delete(tabId);
    });

    chrome.tabs.onReplaced?.addListener((addedTabId, removedTabId) => {
      const record = tabRecords.get(removedTabId);
      if (record) {
        tabRecords.set(addedTabId, record);
        tabRecords.delete(removedTabId);
      }
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          return;
        }
        syncWithTab(tab);
      });
    });

    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError || !Array.isArray(tabs)) {
        return;
      }
      tabs.forEach((tab) => {
        if (tab && tab.id !== undefined) {
          syncWithTab(tab);
        }
      });
    });
  }

  function formatState(tabId) {
    const record = tabRecords.get(tabId);
    if (!record || !record.entries.length) {
      return { tabId, current: null, back: [], forward: [] };
    }
    const clampedIndex = Math.min(Math.max(record.index, 0), record.entries.length - 1);
    record.index = clampedIndex;
    const entries = record.entries;
    const current = entries[clampedIndex] ? cloneEntry(entries[clampedIndex]) : null;
    const back = clampedIndex > 0 ? entries.slice(0, clampedIndex).map(cloneEntry).reverse() : [];
    const forward = clampedIndex < entries.length - 1 ? entries.slice(clampedIndex + 1).map(cloneEntry) : [];
    return { tabId, current, back, forward };
  }

  async function getActiveState() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || activeTab.id === undefined) {
        return { tabId: null, current: null, back: [], forward: [] };
      }
      syncWithTab(activeTab);
      return formatState(activeTab.id);
    } catch (err) {
      return { tabId: null, current: null, back: [], forward: [] };
    }
  }

  function getStateForTab(tabId) {
    return formatState(tabId);
  }

  return {
    init: registerListeners,
    getActiveState,
    getStateForTab,
    syncWithTab,
  };
}
