export interface Mention { id: string; label: string }
export function extractMentions(body: string): Mention[] {
  const found = new Map<string, Mention>()
  for (const match of body.matchAll(/@\[([^\]]+)]\(([^)]+)\)/g)) {
    const label = match[1]?.trim()
    const id = match[2]?.trim()
    if (label && id && !found.has(id)) found.set(id, { id, label })
  }
  return [...found.values()]
}
export function renderMentionText(body: string): string {
  return body.replace(/@\[([^\]]+)]\([^)]+\)/g, '@$1')
}
