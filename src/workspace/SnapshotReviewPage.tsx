import { useEffect, useRef, useState } from 'react'
import { PageTitle } from '../components/PageTitle'
import {
  collectionSignature, compareCollectionSnapshot, createCollectionSnapshot, MAX_SNAPSHOT_CHARACTERS,
  SnapshotError, type Difference, type SnapshotAdapter, type SnapshotComparison,
} from './collectionSnapshot'
import './snapshotReview.css'

type View = Difference | 'differences' | 'all'
const labels: Record<Difference, string> = { added: 'Added', changed: 'Changed', removed: 'Removed', unchanged: 'Unchanged' }
function message(error: unknown) {
  return error instanceof SnapshotError ? error.message :
    'The current collection could not be read safely. Open its workspace for recovery, then retry. No saved data was changed.'
}
export function SnapshotReviewPage<T>({ adapter }: { adapter: SnapshotAdapter<T> }) {
  const [raw, setRaw] = useState('')
  const [comparison, setComparison] = useState<SnapshotComparison | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [stale, setStale] = useState(false)
  const [view, setView] = useState<View>('differences')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState('')
  const inputVersion = useRef(0)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const focusResult = useRef(false)
  useEffect(() => () => { inputVersion.current++ }, [])
  useEffect(() => {
    if (comparison && focusResult.current) { resultHeading.current?.focus(); focusResult.current = false }
  }, [comparison])
  useEffect(() => {
    if (!comparison) return
    const check = () => {
      try { setStale(collectionSignature(adapter, window.localStorage) !== comparison.currentSignature) }
      catch { setStale(true) }
    }
    window.addEventListener('storage', check)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('storage', check)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [adapter, comparison])

  function edit(value: string) {
    inputVersion.current++
    setRaw(value); setComparison(null); setSelected(''); setError(''); setNotice(''); setLoading(false); setStale(false)
  }
  async function openFile(file: File | undefined) {
    if (!file) return
    const version = ++inputVersion.current
    setComparison(null); setSelected(''); setError(''); setNotice(''); setStale(false)
    if (file.size > MAX_SNAPSHOT_CHARACTERS) {
      setLoading(false); setError('This file exceeds the 20 MB snapshot file limit. Your existing text has been kept.'); return
    }
    setLoading(true)
    try {
      const text = await file.text()
      if (version !== inputVersion.current) return
      if (text.length > MAX_SNAPSHOT_CHARACTERS) throw new SnapshotError('The snapshot exceeds the supported size.')
      setRaw(text); setNotice('File loaded. Compare it before making any decisions.')
    } catch (failure) {
      if (version === inputVersion.current) setError(failure instanceof SnapshotError ? failure.message : 'The file could not be read. Choose it again or paste JSON; your existing text has been kept.')
    } finally { if (version === inputVersion.current) setLoading(false) }
  }
  function compare() {
    setError(''); setNotice('')
    try {
      const next = compareCollectionSnapshot(raw, adapter, window.localStorage)
      focusResult.current = true
      setComparison(next); setStale(false); setPage(0); setSelected('')
      setNotice('Comparison ready. No saved data was changed.')
    } catch (failure) { setComparison(null); setSelected(''); setError(message(failure)) }
  }
  function download() {
    setError(''); setNotice('')
    try {
      const json = createCollectionSnapshot(adapter, window.localStorage)
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = adapter.product.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-collection-snapshot-v1.json'
      document.body.append(link)
      try { link.click() } finally { link.remove(); window.setTimeout(() => { URL.revokeObjectURL(url) }, 0) }
      setNotice('Snapshot download requested. Keep it private; it may contain sensitive collection records.')
    } catch (failure) {
      setError(failure instanceof SnapshotError ? failure.message : 'The snapshot could not be downloaded. Check the collection and browser download permissions, then retry. No saved data was changed.')
    }
  }
  const needle = query.trim().toLowerCase()
  const filtered = (comparison?.rows ?? []).filter(row =>
    (view === 'all' || (view === 'differences' ? row.status !== 'unchanged' : row.status === view)) &&
    (!needle || [row.id, row.label, row.group].some(value => value.toLowerCase().includes(needle))))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * 10, (currentPage + 1) * 10)
  const detail = comparison?.rows.find(row => row.key === selected)
  return <section className="suite-page snapshot-review" aria-label={adapter.product + ' collection snapshots'}>
    <PageTitle eyebrow={adapter.product + ' / DATA CONTINUITY'} title="Collection snapshots"
      detail={adapter.label + ' · Export a private copy and compare it with current local records.'}
      actions={<button className="primary" type="button" onClick={download}>Download collection snapshot</button>} />
    <p className="snapshot-scope">This covers only {adapter.label.toLowerCase()}, including its saved history and related sources. It is not a full-workspace backup. Unsaved edits and other stores are not included. Downloads are unencrypted; no data is uploaded.</p>
    <section className="snapshot-input" aria-labelledby="snapshot-input-title">
      <h2 id="snapshot-input-title">Review a snapshot</h2>
      <p>Comparison is read-only. Added and removed mean differences from the current collection, not actions that will run. This screen cannot import, restore or overwrite records.</p>
      <label htmlFor="snapshot-file">Snapshot file <span>(optional, up to 20 MB)</span></label>
      <input id="snapshot-file" type="file" accept=".json,application/json" onChange={event => {
        void openFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''
      }} />
      <label htmlFor="snapshot-json">Snapshot JSON</label>
      <textarea id="snapshot-json" rows={7} spellCheck={false} value={raw} maxLength={MAX_SNAPSHOT_CHARACTERS}
        aria-describedby="snapshot-input-help" onChange={event => { edit(event.target.value) }} />
      <p id="snapshot-input-help">Use a version 1 collection snapshot from this product. Raw recovery downloads and Operations backups use different formats. Editing this text clears the previous comparison.</p>
      <div className="snapshot-actions"><button className="primary" type="button" disabled={loading || !raw.trim()} onClick={compare}>Compare snapshot</button></div>
      <p role="status" aria-live="polite">{loading ? 'Reading snapshot file… You can paste newer text to cancel this read.' : notice}</p>
      {error && <p role="alert" className="snapshot-error">{error}</p>}
    </section>
    {comparison && <section aria-labelledby="snapshot-result-title" className="snapshot-results">
      <h2 id="snapshot-result-title" tabIndex={-1} ref={resultHeading}>Snapshot comparison</h2>
      <p>Snapshot created {comparison.createdAt}. Compared with local data at your last review.</p>
      {stale && <div role="alert" className="snapshot-stale"><p>Current data changed or could not be checked. These results are out of date; your snapshot text is preserved.</p><button type="button" onClick={compare}>Refresh comparison</button></div>}
      <p>{comparison.payloadChanged ? 'The complete collection differs. History or metadata outside the listed records may also differ.' : 'The complete collection matches, including saved history and metadata.'}</p>
      <dl className="snapshot-counts">{(Object.keys(labels) as Difference[]).map(status => <div key={status}><dt>{labels[status]}</dt><dd>{comparison.counts[status]}</dd></div>)}</dl>
      <div className="snapshot-filters">
        <label>Show records<select aria-label="Show records" value={view} onChange={event => { setView(event.target.value as View); setPage(0) }}>
          <option value="differences">Differences only</option><option value="all">All records</option>
          {(Object.keys(labels) as Difference[]).map(status => <option key={status} value={status}>{labels[status]}</option>)}
        </select></label>
        <label>Find record<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
      </div>
      <p>{filtered.length} matching records · Page {currentPage + 1} of {pageCount}</p>
      {visible.length ? <ul className="snapshot-records" aria-label="Compared records">{visible.map(row => <li key={row.key}>
        <button type="button" aria-label={'Inspect ' + row.id} aria-pressed={selected === row.key} onClick={() => { setSelected(row.key) }}>
          <span><strong>{row.id}</strong><span>{row.label}</span></span><span>{row.group}</span><span>{labels[row.status]}</span>
        </button>
      </li>)}</ul> : <p className="snapshot-empty">No records match this view. Choose All records or clear your search. Collection history and metadata are still included in the complete comparison.</p>}
      <div className="snapshot-actions">
        <button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1) }}>Previous records</button>
        <button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => { setPage(currentPage + 1) }}>Next records</button>
      </div>
      {detail && <section className="snapshot-detail" aria-label="Selected record detail">
        <h3>{detail.id}</h3><p>{detail.group} · {labels[detail.status]}</p>
        {!visible.some(row => row.key === selected) && <p>This selected record is outside the current view.</p>}
        <div className="snapshot-detail-columns">
          <details><summary>Current local record</summary><pre>{detail.before === undefined ? 'Not present in current collection.' : JSON.stringify(detail.before, null, 2)}</pre></details>
          <details><summary>Snapshot record</summary><pre>{detail.after === undefined ? 'Not present in snapshot.' : JSON.stringify(detail.after, null, 2)}</pre></details>
        </div>
      </section>}
    </section>}
  </section>
}
