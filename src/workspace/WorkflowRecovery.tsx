import { Component, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { StoredDataError } from './storageValidation'
import './workflowRecovery.css'

export function WorkflowRecovery({ error, productName }: { error: unknown; productName: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [notice, setNotice] = useState('')
  const failure = error instanceof StoredDataError ? error : null
  useEffect(() => { heading.current?.focus() }, [])
  function download() {
    if (!failure) return
    try {
      // Export only the failed, known storage key and only after explicit user action.
      const raw = window.localStorage.getItem(failure.key)
      if (raw === null) { setNotice('This saved entry is no longer present. Nothing was downloaded. Retry this page to read the current workspace.'); return }
      const url = URL.createObjectURL(new Blob([raw], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${productName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-recovery.txt`
      document.body.append(link)
      try { link.click() } finally { link.remove(); window.setTimeout(() => { URL.revokeObjectURL(url) }, 0) }
      setNotice('Recovery download requested. Keep this file private; it may contain sensitive workspace information.')
    } catch { setNotice('The recovery copy could not be downloaded. Check browser storage and download permissions, then try again. No saved data was changed.') }
  }
  return <main className="suite-page workflow-recovery" aria-labelledby="recovery-title">
    <header><p className="recovery-context">{productName} / Workspace recovery</p>
      <h1 id="recovery-title" ref={heading} tabIndex={-1}>{failure ? 'Saved workspace data needs attention' : 'This screen could not be opened'}</h1>
      <p>{failure ? failure.message : 'The workflow stopped before it could finish rendering. Retry this page. If the problem continues, return to the overview and report which workflow you were opening.'}</p>
    </header>
    <section aria-labelledby="recovery-next"><h2 id="recovery-next">Your next step</h2>
      <p>No automatic reset or deletion has been performed. Retrying keeps the current address and selection in the URL. Unsaved form edits may not be recoverable.</p>
      {failure && <p>Before repairing saved data, download a private recovery copy. This is the current text of the affected entry, not a validated backup or a full-workspace export.</p>}
      <div className="recovery-actions">
        <button className="primary" onClick={() => { window.location.reload() }}>Retry this page</button>
        {failure && <button onClick={download}>Download recovery copy</button>}
        <a href="/">Return to overview</a>
      </div>
      <p role="status" aria-live="polite">{notice}</p>
    </section>
  </main>
}

export function RouteRecovery({ productName }: { productName: string }) {
  return <WorkflowRecovery error={useRouteError()} productName={productName} />
}

/** Also covers provider initialization failures outside the router, such as denied storage access. */
export class AppRecoveryBoundary extends Component<{ children: ReactNode; productName: string }, { failed: boolean; error: unknown }> {
  override state = { failed: false, error: undefined as unknown }
  static getDerivedStateFromError(error: unknown) { return { failed: true, error } }
  override render() {
    return this.state.failed ? <WorkflowRecovery error={this.state.error} productName={this.props.productName} /> : this.props.children
  }
}
