import { fileURLToPath } from 'node:url'
import { auditArchitecture } from './architecture.mjs'

try {
  const result = auditArchitecture(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
  for (const issue of result.diagnostics) console.error(`${issue.file}:${issue.line} [${issue.code}] ${issue.message}`)
  if (result.diagnostics.length) {
    console.error(`Architecture failed: ${result.diagnostics.length} violation(s).`)
    process.exitCode = 1
  } else console.log(`Architecture passed: ${result.files} production modules, ${result.edges} resolved first-party dependencies; no runtime cycles or boundary violations.`)
} catch (error) {
  console.error(`Architecture could not be checked: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
