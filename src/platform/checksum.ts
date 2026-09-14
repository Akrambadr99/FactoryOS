export function stableJson(value: unknown): string {
    if (Array.isArray(value))
        return '[' + value.map(stableJson).join(',') + ']';
    if (value !== null && typeof value === 'object')
        return '{' + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}';
    return JSON.stringify(value);
}
export function checksum(value: unknown): string {
    let hash = 2166136261;
    for (const char of stableJson(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
