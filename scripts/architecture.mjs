import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/i
const excludedPattern = /(?:^|\/)(?:test|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/i
const assets = /\.(?:css|scss|svg|png|jpe?g|gif|webp|ico|woff2?|json)$/i
const sharedRoots = new Set(['workspace', 'platform', 'capabilities', 'components', 'interaction'])
// These existing modules are the explicit React composition boundary, not domain code.
const reactIntegrationFiles = new Set([
  'src/application/context.ts', 'src/application/useAppServices.ts',
  'src/application/services.ts', 'src/workspace/useCollectionExplorer.ts',
  'src/features/decision-workbench/useWorkbenchActions.ts',
  'src/state/useWorkbench.ts', 'src/state/workbenchContext.ts',
])
const reactPackage = /^(?:react(?:-dom|-router|-router-dom)?(?:\/|$)|@tanstack\/react-query(?:\/|$))/
const slash = value => value.replaceAll('\\', '/')
const inside = (parent, file) => {
  const relative = path.relative(parent, file)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${file}`)
    if (entry.isDirectory()) return sourceFiles(file)
    return sourcePattern.test(file) ? [file] : []
  }).sort()
}

/** Read syntax, not text matching: comments and string contents are never dependencies. */
export function moduleReferences(source, fileName = 'source.ts') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const references = [], errors = []
  const add = (node, value, typeOnly = false) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    if (value && ts.isStringLiteralLike(value)) references.push({ specifier: value.text, typeOnly, line })
    else errors.push({ code: 'computed-import', line, message: 'Module dependencies must use literal specifiers; computed imports are not audited.' })
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const names = clause?.namedBindings
      const typeOnly = Boolean(clause?.isTypeOnly || (!clause?.name && names && ts.isNamedImports(names) &&
        names.elements.length && names.elements.every(item => item.isTypeOnly)))
      add(node, node.moduleSpecifier, typeOnly)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const names = node.exportClause
      const typeOnly = Boolean(node.isTypeOnly || (names && ts.isNamedExports(names) &&
        names.elements.length && names.elements.every(item => item.isTypeOnly)))
      add(node, node.moduleSpecifier, typeOnly)
    } else if (ts.isImportTypeNode(node)) {
      add(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, true)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly)
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) add(node, node.arguments[0])
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text.startsWith('glob') &&
        ts.isMetaProperty(node.expression.expression)) {
        errors.push({ code: 'computed-import', line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          message: 'import.meta.glob is outside the literal module graph; use explicit imports.' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const diagnostic of file.parseDiagnostics) errors.push({ code: 'syntax',
    line: file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') })
  return { references, errors }
}

/** Enforce the actual resolved production graph, including type edges for layer rules. */
export function auditArchitecture(projectRoot) {
  const root = fs.realpathSync(projectRoot), src = path.join(root, 'src')
  const configPath = path.join(root, 'tsconfig.app.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, ' '))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, ' ')).join('\n'))
  const allFiles = sourceFiles(src)
  const production = allFiles.filter(file => !excludedPattern.test(slash(path.relative(src, file))))
  const fileSet = new Set(production), edges = [], diagnostics = []
  const relative = file => slash(path.relative(root, file))
  const report = (file, line, code, message) => diagnostics.push({ file: relative(file), line, code, message })
  const checkSharedBoundary = (file, target, line) => {
    const fromRoot = relative(file).split('/')[1], toRoot = relative(target).split('/')[1]
    if (sharedRoots.has(fromRoot) && !sharedRoots.has(toRoot)) {
      report(file, line, 'shared-layer', `Shared ${fromRoot} cannot depend on product/application implementation: ${relative(target)}`)
    }
  }
  const cache = ts.createModuleResolutionCache(root, file => file, parsed.options)
  for (const file of production) {
    const source = fs.readFileSync(file, 'utf8')
    const result = moduleReferences(source, file)
    for (const error of result.errors) report(file, error.line, error.code, error.message)
    const pure = /\.[cm]?[jt]s$/.test(file) && !reactIntegrationFiles.has(relative(file))
    for (const reference of result.references) {
      const { specifier, line, typeOnly } = reference
      if (relative(file) === 'src/platform/storage-port.ts') {
        report(file, line, 'contract-leaf', `The storage contract must remain dependency-free, including type imports: ${specifier}`)
      }
      if (pure && reactPackage.test(specifier)) report(file, line, 'pure-ui', `Pure TypeScript cannot depend on React integration: ${specifier}`)
      // Queries change bundler semantics; do not silently omit an otherwise hidden code edge.
      if (specifier.includes('?') || specifier.includes('#')) {
        report(file, line, 'unsupported-specifier', `Query/hash module specifiers are not audited: ${specifier}`)
        continue
      }
      const resolution = ts.resolveModuleName(specifier, file, parsed.options, ts.sys, cache).resolvedModule
      if (!resolution) {
        const asset = path.resolve(path.dirname(file), specifier)
        if (specifier.startsWith('.') && assets.test(asset) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
          const resolvedAsset = fs.realpathSync(asset)
          if (!inside(src, resolvedAsset)) report(file, line, 'outside-source', `First-party assets must remain inside src: ${specifier}`)
          else if (!assets.test(resolvedAsset)) report(file, line, 'unsupported-specifier', `Asset imports cannot hide source modules: ${specifier}`)
          else checkSharedBoundary(file, resolvedAsset, line)
          continue
        }
        report(file, line, 'unresolved', `Cannot resolve module: ${specifier}`)
        continue
      }
      const target = fs.realpathSync(resolution.resolvedFileName)
      if (pure && !reactPackage.test(specifier) && reactPackage.test(resolution.packageId?.name ?? '')) {
        report(file, line, 'pure-ui', `Pure TypeScript cannot depend on a React package through an alias: ${specifier}`)
      }
      if (!inside(src, target)) {
        if (!resolution.isExternalLibraryImport || !slash(target).includes('/node_modules/')) {
          report(file, line, 'outside-source', `First-party dependencies must remain inside src: ${specifier}`)
        }
        continue
      }
      if (assets.test(target)) {
        checkSharedBoundary(file, target, line)
        continue
      }
      if (!fileSet.has(target)) {
        report(file, line, 'excluded-source', `Production code cannot import excluded test/declaration sources: ${relative(target)}`)
        continue
      }
      edges.push({ from: file, to: target, typeOnly, line })
      checkSharedBoundary(file, target, line)
      if (pure && (/\.[jt]sx$/.test(target) || reactIntegrationFiles.has(relative(target)))) {
        report(file, line, 'pure-ui', `Pure TypeScript cannot depend on a UI integration module: ${relative(target)}`)
      }
    }
  }
  // Tarjan SCCs report every runtime cycle once. Explicit type-only edges cannot create runtime cycles.
  const adjacency = new Map(production.map(file => [file, []]))
  for (const edge of edges) if (!edge.typeOnly) adjacency.get(edge.from).push(edge.to)
  let index = 0
  const indices = new Map(), low = new Map(), stack = [], active = new Set()
  function visit(file) {
    indices.set(file, index); low.set(file, index); index++; stack.push(file); active.add(file)
    for (const target of adjacency.get(file)) {
      if (!indices.has(target)) { visit(target); low.set(file, Math.min(low.get(file), low.get(target))) }
      else if (active.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)))
    }
    if (low.get(file) !== indices.get(file)) return
    const component = []
    let next
    do { next = stack.pop(); active.delete(next); component.push(next) } while (next !== file)
    if (component.length > 1 || adjacency.get(file).includes(file)) {
      component.sort()
      report(component[0], 1, 'runtime-cycle', `Runtime dependency cycle group: ${component.map(relative).join(', ')}`)
    }
  }
  for (const file of production) if (!indices.has(file)) visit(file)
  diagnostics.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code))
  return { files: production.length, edges: edges.length, diagnostics }
}
