import { describe, expect, it } from 'vitest'
import { duplicateTargets, mapImportRows } from './mapping'
describe('import mapping', () => {
  it('reports required values with spreadsheet row numbers', () => expect(mapImportRows(['Name'], [['']], [{ key: 'name', required: true }], [{ source: 'Name', target: 'name' }])[0]).toMatchObject({ row: 2, errors: ['name is required.'] }))
  it('trims mapped input', () => expect(mapImportRows(['Name'], [[' Alice ']], [{ key: 'name', required: true }], [{ source: 'Name', target: 'name' }])[0]?.values['name']).toBe('Alice'))
  it('finds ambiguous targets', () => expect(duplicateTargets([{ source: 'One', target: 'name' }, { source: 'Two', target: 'name' }])).toEqual(['name']))
})
