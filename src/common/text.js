export function normalizeText(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  return normalized.split(/\s+/).filter(Boolean);
}
