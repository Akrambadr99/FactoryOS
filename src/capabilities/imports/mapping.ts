export interface ImportField { key: string; required: boolean }
export interface ImportMapping { source: string; target: string }
export interface MappedRow { row: number; values: Record<string, string>; errors: string[] }
export function mapImportRows(headers: readonly string[], rows: readonly (readonly string[])[], fields: readonly ImportField[], mapping: readonly ImportMapping[]): MappedRow[] {
  const sourceIndexes = new Map(headers.map((header, index) => [header, index]))
  return rows.map((row, rowIndex) => {
    const values: Record<string, string> = {}
    const errors: string[] = []
    for (const field of fields) {
      const source = mapping.find(item => item.target === field.key)?.source
      const index = source ? sourceIndexes.get(source) : undefined
      const value = index === undefined ? '' : row[index]?.trim() ?? ''
      values[field.key] = value
      if (field.required && !value) errors.push(field.key + ' is required.')
    }
    return { row: rowIndex + 2, values, errors }
  })
}
export function duplicateTargets(mapping: readonly ImportMapping[]): string[] { return [...new Set(mapping.map(item => item.target).filter((target, index, all) => all.indexOf(target) !== index))] }
