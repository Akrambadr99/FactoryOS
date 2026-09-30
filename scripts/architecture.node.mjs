import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { auditArchitecture, moduleReferences } from './architecture.mjs'

function fixture(t, files, compilerOptions = {}) {
  const tempDirectory = fs.realpathSync(os.tmpdir())
  const root = fs.mkdtempSync(path.join(tempDirectory, 'architecture-contract-'))
  t.after(() => {
    const resolved = fs.realpathSync(root)
    assert.equal(resolved, path.resolve(root), 'Fixture cleanup cannot follow a substituted path')
    assert.equal(path.dirname(resolved), tempDirectory, 'Fixture cleanup must stay in its original temporary directory')
    assert.ok(path.basename(resolved).startsWith('architecture-contract-'), 'Fixture cleanup requires its exact generated target')
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  fs.writeFileSync(path.join(root, 'tsconfig.app.json'), JSON.stringify({
    compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'bundler', ...compilerOptions }, include: ['src'],
  }))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content)
  }
  return root
}
const codes = result => result.diagnostics.map(issue => issue.code)

test('syntax reader recognizes all literal import and re-export forms with type edges', () => {
  const result = moduleReferences(`
    import type { A } from './a'; import { type B } from './b';
    import value, { type C } from './c'; import './side-effect';
    export type { D } from './d'; export { type E } from './e'; export * from './f';
    type T = import('./g').T; import H = require('./h');
    const loaded = import('./i'); const required = require('./j');
  `)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.references.map(item => [item.specifier, item.typeOnly]), [
    ['./a', true], ['./b', true], ['./c', false], ['./side-effect', false],
    ['./d', true], ['./e', true], ['./f', false], ['./g', true], ['./h', false], ['./i', false], ['./j', false],
  ])
})

test('syntax reader ignores comments and ordinary strings', () => {
  const result = moduleReferences(`// import X from './fake';\nconst text = "import('./fake')"`)
  assert.deepEqual(result, { references: [], errors: [] })
})

test('computed import, require and glob fail closed', () => {
  const result = moduleReferences('import(name); require(name); import.meta.glob("./*.ts")')
  assert.equal(result.errors.length, 3)
  assert.ok(result.errors.every(issue => issue.code === 'computed-import'))
})

test('syntax errors fail closed', () => {
  assert.ok(moduleReferences('import { broken from').errors.some(issue => issue.code === 'syntax'))
})

test('valid shared graph resolves extensionless, index and .js TypeScript substitution', t => {
  const root = fixture(t, {
    'src/workspace/model.ts': 'import { x } from "../platform/values.js"; export { y } from "../capabilities/entry"; export const result = x;',
    'src/platform/values.ts': 'export const x = 1;',
    'src/capabilities/entry/index.ts': 'export const y = 2;',
  })
  assert.deepEqual(auditArchitecture(root), { files: 3, edges: 2, diagnostics: [] })
})

test('resolved aliases cannot bypass shared-layer boundaries', t => {
  const root = fixture(t, {
    'src/workspace/entry.ts': 'import type { Model } from "@product/model"; export type X = Model;',
    'src/product/model.ts': 'export interface Model { id: string }',
  }, { paths: { '@product/*': ['./src/product/*'] } })
  assert.deepEqual(codes(auditArchitecture(root)), ['shared-layer'])
})

for (const form of [
  'export * from "../product/model"',
  'export type { Model } from "../product/model"',
  'export type X = import("../product/model").Model',
  'export const load = () => import("../product/model")',
]) test(`shared boundary covers ${form}`, t => {
  const root = fixture(t, {
    'src/platform/entry.ts': form,
    'src/product/model.ts': 'export interface Model { id: string }; export const value = 1;',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['shared-layer'])
})

test('generic component barrels cannot hide product dependencies', t => {
  const root = fixture(t, {
    'src/workspace/Page.tsx': 'export * from "../components/barrel";',
    'src/components/barrel.ts': 'export * from "../features/private";',
    'src/features/private.ts': 'export const value = 1;',
  })
  const result = auditArchitecture(root)
  assert.equal(result.diagnostics[0].file, 'src/components/barrel.ts')
  assert.deepEqual(codes(result), ['shared-layer'])
})

test('explicit type-only dependency cycles are allowed', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'import type { B } from "./b"; export interface A { b: B }',
    'src/domain/b.ts': 'import { type A } from "./a"; export interface B { a: A }',
  })
  assert.deepEqual(codes(auditArchitecture(root)), [])
})

test('runtime cycle is detected once even with extra incoming dependencies', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'export * from "./b"; export const a = 1;',
    'src/domain/b.ts': 'import { a } from "./a"; export const b = a;',
    'src/domain/c.ts': 'export * from "./a";',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['runtime-cycle'])
})

test('self imports and dynamic runtime cycles are detected', t => {
  const root = fixture(t, { 'src/domain/a.ts': 'export const load = () => import("./a")' })
  assert.deepEqual(codes(auditArchitecture(root)), ['runtime-cycle'])
})

test('a type-only back edge does not turn a runtime chain into a cycle', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'export * from "./b"; export interface A {}',
    'src/domain/b.ts': 'export type { A } from "./a"; export const b = 1;',
  })
  assert.deepEqual(codes(auditArchitecture(root)), [])
})

test('unresolved relative and alias imports are errors', t => {
  const root = fixture(t, { 'src/domain/a.ts': 'import "./missing"; import "@missing/model";' })
  assert.deepEqual(codes(auditArchitecture(root)), ['unresolved', 'unresolved'])
})

test('production cannot import test code, even through an alias', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'import { value } from "@fixture";',
    'src/test/fixture.ts': 'export const value = 1;',
  }, { paths: { '@fixture': ['./src/test/fixture.ts'] } })
  const result = auditArchitecture(root)
  assert.equal(result.files, 1)
  assert.deepEqual(codes(result), ['excluded-source'])
})

test('unimported test fixtures are excluded from the production graph', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'export const value = 1;',
    'src/domain/a.test.ts': 'import "missing-test-dependency";',
    'src/test/setup.ts': 'import "missing-test-dependency";',
  })
  assert.deepEqual(auditArchitecture(root), { files: 1, edges: 0, diagnostics: [] })
})

test('pure TypeScript cannot import TSX through an extensionless path', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'import { View } from "../features/View";',
    'src/features/View.tsx': 'export const View = () => null;',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['pure-ui'])
})

test('pure TypeScript cannot import a named hook integration as a back door', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'import { value } from "../state/useWorkbench";',
    'src/state/useWorkbench.ts': 'export const value = 1;',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['pure-ui'])
})

test('a JavaScript intermediary cannot conceal a UI dependency from a pure module', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'export * from "./barrel.js";',
    'src/domain/barrel.js': 'export * from "../features/View";',
    'src/features/View.tsx': 'export const View = () => null;',
  }, { allowJs: true })
  const result = auditArchitecture(root)
  assert.deepEqual(codes(result), ['pure-ui'])
  assert.equal(result.diagnostics[0].file, 'src/domain/barrel.js')
})

test('the storage port is a dependency-free leaf even for type-only imports', t => {
  const root = fixture(t, {
    'src/platform/storage-port.ts': 'import type { Value } from "./value"; export interface StoragePort { value: Value }',
    'src/platform/value.ts': 'export interface Value {}',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['contract-leaf'])
})

for (const specifier of ['react/jsx-runtime', 'react-dom/client', 'react-router-dom', '@tanstack/react-query']) {
  test(`pure framework imports reject ${specifier}`, t => {
  const root = fixture(t, { 'src/domain/a.ts': `import '${specifier}';` })
  assert.ok(codes(auditArchitecture(root)).includes('pure-ui'))
  })
}

test('explicit integration files may use React without allowing domain imports of them', t => {
  const root = fixture(t, {
    'src/state/useWorkbench.ts': 'import { useState } from "react"; export const hook = useState;',
    'node_modules/react/package.json': '{"name":"react","version":"1.0.0","types":"index.d.ts"}',
    'node_modules/react/index.d.ts': 'export declare function useState(): void;',
  })
  assert.deepEqual(codes(auditArchitecture(root)), [])
})

test('existing relative styles are allowed; missing assets fail', t => {
  const root = fixture(t, {
    'src/components/Page.tsx': 'import "./page.css"; import "./missing.svg";',
    'src/components/page.css': '.page { color: black }',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['unresolved'])
})

test('query imports cannot bypass the graph', t => {
  const root = fixture(t, { 'src/domain/a.ts': 'import "../product/model?raw";' })
  assert.deepEqual(codes(auditArchitecture(root)), ['unsupported-specifier'])
})

test('first-party imports outside src fail', t => {
  const root = fixture(t, {
    'src/domain/a.ts': 'import { value } from "../../outside";', 'outside.ts': 'export const value = 1;',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['outside-source'])
})

test('existing asset fallback cannot escape src', t => {
  const root = fixture(t, {
    'src/components/Page.tsx': 'import "../../outside.css";', 'outside.css': '.page { color: black }',
  })
  assert.deepEqual(codes(auditArchitecture(root)), ['outside-source'])
})


for (const [extension, resolveJsonModule] of [['json', false], ['json', true], ['css', false]]) {
  test(`shared asset boundaries cover ${extension} with JSON resolution ${resolveJsonModule}`, t => {
    const root = fixture(t, {
      'src/components/Page.tsx': `import '../product/content.${extension}';`,
      [`src/product/content.${extension}`]: extension === 'json' ? '{"label":"product only"}' : '.product {}',
    }, { resolveJsonModule })
    assert.deepEqual(codes(auditArchitecture(root)), ['shared-layer'])
  })
}

test('resolved JSON in a shared root is a data asset, not an excluded code dependency', t => {
  const root = fixture(t, {
    'src/workspace/model.ts': 'import data from "../platform/content.json"; export const value = data;',
    'src/platform/content.json': '{"format":1}',
  }, { resolveJsonModule: true })
  assert.deepEqual(auditArchitecture(root), { files: 1, edges: 0, diagnostics: [] })
})

test('CLI exits nonzero with actionable source location on a violation', t => {
  const root = fixture(t, { 'src/domain/a.ts': 'import "./missing";' })
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-architecture.mjs', import.meta.url)), root], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /src\/domain\/a.ts:1 \[unresolved\]/)
})

test('CLI exits zero and reports module counts for a valid graph', t => {
  const root = fixture(t, { 'src/domain/a.ts': 'export const value = 1;' })
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-architecture.mjs', import.meta.url)), root], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Architecture passed: 1 production modules, 0 resolved/)
})
