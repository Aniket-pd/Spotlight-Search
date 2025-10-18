function isHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (err) {
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchFaviconData(url) {
  if (!isHttpUrl(url)) {
    return null;
  }
  const requestUrl = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 3000) : null;
  try {
    const response = await fetch(requestUrl, {
      signal: controller?.signal,
      cache: "force-cache",
      mode: "cors",
    });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return null;
    }
    const buffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = blob.type || "image/png";
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.warn("Spotlight: favicon fetch failed", err);
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function resolveTabFavicon(tabId) {
  if (typeof tabId !== "number") {
    return null;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      return tab.favIconUrl;
    }
  } catch (err) {
    // tab may have closed; ignore
  }
  return null;
}

function getOriginFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
}

export function createFaviconService({ cache }) {
  async function resolveFaviconForTarget(target) {
    if (!target) {
      return { origin: "", faviconUrl: null };
    }
    const origin = target.origin || getOriginFromUrl(target.url) || "";
    if (!origin) {
      return { origin: "", faviconUrl: null };
    }

    if (cache.has(origin)) {
      return { origin, faviconUrl: cache.get(origin) };
    }

    let faviconUrl = null;

    if (target.type === "tab") {
      faviconUrl = await resolveTabFavicon(target.tabId);
    }

    if (!faviconUrl && target.url) {
      faviconUrl = await fetchFaviconData(target.url);
    }

    cache.set(origin, faviconUrl || null);
    return { origin, faviconUrl: faviconUrl || null };
  }

  return { resolveFaviconForTarget };
}
