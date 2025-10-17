export function getDomainFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (err) {
    return "";
  }
}

export function getOriginFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.origin || "";
  } catch (err) {
    return "";
  }
}

export function isHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (err) {
    return false;
  }
}

export function extractHostname(url) {
  return getDomainFromUrl(url);
}
