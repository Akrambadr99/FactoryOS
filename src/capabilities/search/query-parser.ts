export interface SearchToken { field?: string; value: string; negated: boolean }
export function parseSearchQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = []
  for (const match of query.matchAll(/(-)?(?:(\w+):)?(?:"([^"]*)"|(\S+))/g)) {
    const value = (match[3] ?? match[4] ?? '').trim()
    if (value) tokens.push({ ...(match[2] ? { field: match[2].toLowerCase() } : {}), value, negated: Boolean(match[1]) })
  }
  return tokens
}
export function matchesSearch(record: Record<string, string>, tokens: readonly SearchToken[]): boolean {
  return tokens.every(token => { const values = token.field ? [record[token.field] ?? ''] : Object.values(record); const found = values.some(value => value.toLowerCase().includes(token.value.toLowerCase())); return token.negated ? !found : found })
}
