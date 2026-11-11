export function normalizeAlphanumericIdentifier(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    const normalized = value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    return normalized || null;
}
