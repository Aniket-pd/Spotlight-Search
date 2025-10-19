const DEFAULT_TITLE_FALLBACK = "Download";

function safeParseTimestamp(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function extractFilename(path) {
  if (typeof path !== "string" || !path) {
    return "";
  }
  const normalized = path.replace(/\\+/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) {
    return path;
  }
  return segments[segments.length - 1];
}

function extractParentFolder(path) {
  if (typeof path !== "string" || !path) {
    return "";
  }
  const normalized = path.replace(/\\+/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return normalized.slice(0, lastSlash + 1);
}

function extractOrigin(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
}

function extractExtension(filename) {
  if (typeof filename !== "string" || !filename) {
    return "";
  }
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return "";
  }
  return filename.slice(lastDot + 1).toLowerCase();
}

function formatDownloadTitle(filename, url) {
  if (filename) {
    return filename;
  }
  if (url) {
    try {
      const parsed = new URL(url);
      return extractFilename(parsed.pathname) || parsed.hostname || DEFAULT_TITLE_FALLBACK;
    } catch (err) {
      return DEFAULT_TITLE_FALLBACK;
    }
  }
  return DEFAULT_TITLE_FALLBACK;
}

export function normalizeDownloadItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const filePath = typeof item.filename === "string" ? item.filename : "";
  const filename = extractFilename(filePath);
  const folderPath = extractParentFolder(filePath);
  const fileUrl = item.finalUrl || item.url || "";
  const startTime = safeParseTimestamp(item.startTime);
  const endTime = safeParseTimestamp(item.endTime);
  const estimatedEndTime = safeParseTimestamp(item.estimatedEndTime);
  const bytesReceived = typeof item.bytesReceived === "number" ? item.bytesReceived : 0;
  const totalBytes = typeof item.totalBytes === "number" ? item.totalBytes : 0;
  const progress = totalBytes > 0 ? Math.min(1, Math.max(0, bytesReceived / totalBytes)) : item.state === "complete" ? 1 : 0;
  const extension = extractExtension(filename);
  const origin = extractOrigin(fileUrl || item.url || "");

  return {
    id: item.id,
    downloadId: item.id,
    type: "download",
    title: formatDownloadTitle(filename, fileUrl || item.url || ""),
    url: fileUrl || item.url || "",
    fileUrl: fileUrl || item.url || "",
    filename,
    filePath,
    folderPath,
    extension,
    state: item.state || "in_progress",
    danger: item.danger || "safe",
    startTime,
    endTime,
    estimatedEndTime,
    createdAt: startTime || Date.now(),
    completedAt: endTime || null,
    bytesReceived,
    totalBytes,
    progress,
    paused: Boolean(item.paused),
    canResume: Boolean(item.canResume),
    exists: typeof item.exists === "boolean" ? item.exists : true,
    mime: item.mime || "",
    referrer: item.referrer || "",
    byExtensionName: item.byExtensionName || "",
    byExtensionId: item.byExtensionId || "",
    origin,
  };
}

export const DOWNLOAD_INDEX_LIMIT = 200;
