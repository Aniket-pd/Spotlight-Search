function injectToggleScript() {
  const DARK_MODE_STYLE_ID = "spotlight-site-dark-mode-style";
  const DARK_MODE_CLASS = "spotlight-site-dark-mode";
  const root = document.documentElement || document.body;
  if (!root) {
    return null;
  }

  const head = document.head || root;
  let styleEl = document.getElementById(DARK_MODE_STYLE_ID);
  const hasStyle = Boolean(styleEl);

  if (!hasStyle) {
    styleEl = document.createElement("style");
    styleEl.id = DARK_MODE_STYLE_ID;
    styleEl.textContent = `
      html.${DARK_MODE_CLASS} {
        color-scheme: dark;
        background-color: #0f172a !important;
      }
      html.${DARK_MODE_CLASS},
      html.${DARK_MODE_CLASS} body {
        background-color: #0f172a !important;
        color: #e2e8f0 !important;
      }
      html.${DARK_MODE_CLASS} a {
        color: #93c5fd !important;
      }
      html.${DARK_MODE_CLASS} button,
      html.${DARK_MODE_CLASS} input,
      html.${DARK_MODE_CLASS} textarea,
      html.${DARK_MODE_CLASS} select {
        background-color: #1e293b !important;
        color: #f8fafc !important;
        border-color: rgba(148, 163, 184, 0.4) !important;
      }
      html.${DARK_MODE_CLASS} img,
      html.${DARK_MODE_CLASS} video,
      html.${DARK_MODE_CLASS} picture,
      html.${DARK_MODE_CLASS} iframe,
      html.${DARK_MODE_CLASS} canvas {
        filter: invert(1) hue-rotate(180deg) contrast(0.95) !important;
      }
    `;
  }

  const enabled = !root.classList.contains(DARK_MODE_CLASS);

  if (enabled) {
    if (!styleEl.parentNode) {
      head.appendChild(styleEl);
    }
    root.classList.add(DARK_MODE_CLASS);
  } else {
    root.classList.remove(DARK_MODE_CLASS);
    if (styleEl && styleEl.parentNode) {
      styleEl.remove();
    }
  }

  return root.classList.contains(DARK_MODE_CLASS);
}

async function togglePageDarkMode() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || typeof activeTab.id !== "number") {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: injectToggleScript,
      world: "MAIN",
    });
  } catch (err) {
    console.warn("Spotlight: failed to toggle page dark mode", err);
  }
}

export function createPageActions() {
  return {
    togglePageDarkMode,
  };
}
