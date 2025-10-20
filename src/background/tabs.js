function tabTitle(tab) {
  return tab.title || tab.url || "";
}

function tabDomain(tab) {
  if (!tab.url) {
    return "";
  }
  try {
    const url = new URL(tab.url);
    return url.hostname || "";
  } catch (err) {
    return "";
  }
}

function compareTabsByDomainAndTitle(a, b) {
  const domainA = tabDomain(a).toLowerCase();
  const domainB = tabDomain(b).toLowerCase();
  if (domainA !== domainB) {
    return domainA.localeCompare(domainB);
  }

  const titleA = tabTitle(a).toLowerCase();
  const titleB = tabTitle(b).toLowerCase();
  if (titleA !== titleB) {
    return titleA.localeCompare(titleB);
  }

  const urlA = (a.url || "").toLowerCase();
  const urlB = (b.url || "").toLowerCase();
  if (urlA !== urlB) {
    return urlA.localeCompare(urlB);
  }

  const idA = a.id === undefined ? "" : String(a.id);
  const idB = b.id === undefined ? "" : String(b.id);
  return idA.localeCompare(idB);
}

function shuffleInPlace(tabs) {
  for (let i = tabs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  }
}

async function sortAllTabsByDomainAndTitle() {
  const tabs = await chrome.tabs.query({});
  const windows = new Map();

  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) {
      windows.set(tab.windowId, []);
    }
    windows.get(tab.windowId).push(tab);
  }

  for (const [, windowTabs] of windows.entries()) {
    const pinned = windowTabs
      .filter((tab) => tab.pinned)
      .sort((a, b) => a.index - b.index);
    const unpinned = windowTabs
      .filter((tab) => !tab.pinned)
      .sort(compareTabsByDomainAndTitle);

    let targetIndex = pinned.length;
    for (const tab of unpinned) {
      if (tab.index !== targetIndex) {
        try {
          await chrome.tabs.move(tab.id, { index: targetIndex });
        } catch (err) {
          console.warn("Spotlight: failed to move tab during sort", err);
        }
      }
      targetIndex += 1;
    }
  }
}

async function shuffleTabs() {
  const tabs = await chrome.tabs.query({});
  const windows = new Map();

  for (const tab of tabs) {
    if (!windows.has(tab.windowId)) {
      windows.set(tab.windowId, []);
    }
    windows.get(tab.windowId).push(tab);
  }

  for (const [, windowTabs] of windows.entries()) {
    const pinned = windowTabs
      .filter((tab) => tab.pinned)
      .sort((a, b) => a.index - b.index);
    const unpinned = windowTabs.filter((tab) => !tab.pinned);
    shuffleInPlace(unpinned);

    let targetIndex = pinned.length;
    for (const tab of unpinned) {
      if (tab.index !== targetIndex) {
        try {
          await chrome.tabs.move(tab.id, { index: targetIndex });
        } catch (err) {
          console.warn("Spotlight: failed to move tab during shuffle", err);
        }
      }
      targetIndex += 1;
    }
  }
}

function getDomainFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

async function closeTabById(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch (err) {
    console.warn("Spotlight: failed to close tab", err);
  }
}

async function closeAllTabsExceptActive() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const toClose = allTabs
      .filter((tab) => tab.id !== undefined && (!activeTab || tab.id !== activeTab.id))
      .map((tab) => tab.id);
    if (toClose.length) {
      await chrome.tabs.remove(toClose);
    }
  } catch (err) {
    console.warn("Spotlight: failed to close all tabs", err);
  }
}

async function closeTabsByDomain(domain) {
  if (!domain) {
    return;
  }
  const normalized = domain.toLowerCase();
  try {
    const tabs = await chrome.tabs.query({});
    const toClose = tabs
      .filter((tab) => {
        if (tab.id === undefined || !tab.url) {
          return false;
        }
        const tabDomain = getDomainFromUrl(tab.url).toLowerCase();
        return tabDomain === normalized;
      })
      .map((tab) => tab.id);
    if (toClose.length) {
      await chrome.tabs.remove(toClose);
    }
  } catch (err) {
    console.warn("Spotlight: failed to close tabs by domain", err);
  }
}

async function closeAudibleTabs() {
  try {
    const audibleTabs = await chrome.tabs.query({ audible: true });
    const toClose = audibleTabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => tab.id);
    if (toClose.length) {
      await chrome.tabs.remove(toClose);
    }
  } catch (err) {
    console.warn("Spotlight: failed to close audio tabs", err);
  }
}

export function createTabActions() {
  return {
    sortAllTabsByDomainAndTitle,
    shuffleTabs,
    closeTabById,
    closeAllTabsExceptActive,
    closeTabsByDomain,
    closeAudibleTabs,
  };
}
