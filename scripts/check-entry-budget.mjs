import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Phase 3 adds synchronous construction policies to the command registry.
// Keep a bounded ceiling while allowing the product domain to expand.
const maximumRawBytes = 450 * 1024
const maximumGzipBytes = 130 * 1024
const outputDirectory = join(process.cwd(), 'dist')
const html = await readFile(join(outputDirectory, 'index.html'), 'utf8')
const entryMatch = html.match(/<script[^>]+src="\/([^"?]+\.js)"/)

if (!entryMatch?.[1]) {
  throw new Error('The production entry script could not be resolved from index.html.')
}

const entryPath = join(outputDirectory, entryMatch[1])
const [entry, entryStats] = await Promise.all([
  readFile(entryPath),
  stat(entryPath),
])
const gzipBytes = gzipSync(entry).byteLength

if (entryStats.size > maximumRawBytes || gzipBytes > maximumGzipBytes) {
  throw new Error(
    `Entry bundle ${formatBytes(entryStats.size)} raw / ${formatBytes(gzipBytes)} gzip exceeds ` +
      `${formatBytes(maximumRawBytes)} raw / ${formatBytes(maximumGzipBytes)} gzip.`,
  )
}

process.stdout.write(
  `Entry bundle ${formatBytes(entryStats.size)} raw / ${formatBytes(gzipBytes)} gzip is within budget.\n`,
)

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}
