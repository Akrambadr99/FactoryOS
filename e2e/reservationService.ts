import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

/** Own one disposable real service instance; no reset endpoint or shared data directory. */
export async function startReservationService() {
  const temporaryParent = await realpath(tmpdir())
  const directory = await realpath(await mkdtemp(path.join(temporaryParent, 'factoryos-reservations-e2e-')))
  const child = spawn(process.execPath, ['dist-server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, FACTORYOS_DATA_DIR: directory, FACTORYOS_PORT: '4404' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let launchError: Error | undefined
  child.on('error', error => { launchError = error })
  const retain = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4000) }
  child.stdout.on('data', retain)
  child.stderr.on('data', retain)
  let closed = false
  async function close() {
    if (closed) return
    closed = true
    if (child.exitCode === null && child.signalCode === null && !launchError) {
      await new Promise<void>(resolve => {
        const force = setTimeout(() => { child.kill('SIGKILL') }, 5000)
        child.once('exit', () => { clearTimeout(force); resolve() })
        child.kill('SIGTERM')
      })
    }
    const target = await realpath(directory)
    if (target !== directory || path.dirname(target) !== temporaryParent || !path.basename(target).startsWith('factoryos-reservations-e2e-')) {
      throw new Error('Refusing to clean a substituted reservation test directory.')
    }
    await rm(target, { recursive: true, force: true })
  }
  try {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (launchError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error('Reservation service failed to start: ' + (launchError?.message ?? output))
      }
      if (!output.includes('http://127.0.0.1:4404')) { await pause(50); continue }
      try {
        const response = await fetch('http://127.0.0.1:4404/api/reservations', {
          headers: { Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations' },
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok) return { directory, close }
      } catch { /* The owned process may not yet have opened its listener. */ }
      await pause(50)
    }
    throw new Error('Reservation service did not become ready. ' + output)
  } catch (error) {
    await close()
    throw error
  }
}
