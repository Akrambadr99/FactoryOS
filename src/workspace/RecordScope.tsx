/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { StoragePort } from './repository'
import { StoredDataError } from './storageValidation'

const Context = createContext<{ storage: StoragePort; recordId: string; guard: <T extends unknown[]>(action: (...args: T) => void) => (...args: T) => void } | null>(null)
export function useRecordContext() {
  const value = useContext(Context)
  if (!value) throw new Error('A selected record is required.')
  return value
}
export function RecordScope({ id, back, open, children }: {
  id: string; back: string; open: (id: string) => StoragePort; children: ReactNode
}) {
  const [generation, setGeneration] = useState(0)
  return <RecordSession key={id + ':' + String(generation)} id={id} back={back} open={open} restoreFocus={generation > 0}
    reload={() => { setGeneration(value => value + 1) }}>{children}</RecordSession>
}
function RecordSession({ id, back, open, reload, children, restoreFocus }: {
  id: string; back: string; open: (id: string) => StoragePort; reload: () => void; children: ReactNode; restoreFocus: boolean
}) {
  const [session] = useState(() => {
    try { return { storage: open(id), error: '' } }
    catch (error) {
      if (error instanceof StoredDataError) throw error
      return { storage: null, error: error instanceof Error ? error.message : 'Unable to open this record. Retry or return to the workspace.' }
    }
  })
  const [failure, setFailure] = useState('')
  const contextRef = useRef<HTMLElement>(null)
  useEffect(() => {
    document.scrollingElement?.scrollTo({ top: 0, behavior: 'instant' })
    if (restoreFocus) contextRef.current?.focus({ preventScroll: true })
  }, [restoreFocus])
  function guard<T extends unknown[]>(action: (...args: T) => void) {
    return (...args: T) => {
      try { action(...args); setFailure('') }
      catch (error) { setFailure(error instanceof Error ? error.message : 'The change could not be saved. Your input is preserved; try again.') }
    }
  }
  return <>
    <section ref={contextRef} tabIndex={-1} className="suite-card" aria-label="Selected record context">
      <p>Working record: <strong>{id}</strong></p>
      <Link to={back}>Back to workspace</Link>{' '}
      <button onClick={reload}>Reload record and discard local edits</button>
      {(failure || session.error) && <p role="alert">{failure || session.error}</p>}
    </section>
    {session.storage && <Context.Provider value={{ storage: session.storage, recordId: id, guard }}>{children}</Context.Provider>}
  </>
}
