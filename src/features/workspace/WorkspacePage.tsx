/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-deprecated, react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { product } from '../../product/definition';
import type { Repository } from '../../workspace/repository';
import { useAppServices } from '../../application/useAppServices';
import { csv, linkedRecords, queryEntities } from '../../workspace/selectors';
import type { Entity, Field, Snapshot, Value } from '../../workspace/types';
const initialValues = (fields: Field[]) => Object.fromEntries(fields.map(field => [field.key, field.initial ?? (field.type === 'number' ? 0 : '')]));
const download = (name: string, body: string, type: string) => { const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([body], { type })); anchor.download = name; anchor.click(); URL.revokeObjectURL(anchor.href); };
export function WorkspacePage() {
    const { repository } = useAppServices();
    const [snapshot, setSnapshot] = useState<Snapshot>(() => repository.read());
    const [kind, setKind] = useState(product.kinds[0]?.key ?? '');
    const [selectedId, setSelectedId] = useState(product.seed[0]?.id ?? '');
    const [actorId, setActorId] = useState(product.actors[0]?.id ?? '');
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('');
    const [notice, setNotice] = useState('');
    const [dialog, setDialog] = useState<'create' | 'edit' | 'operate' | null>(null);
    const [operation, setOperation] = useState('');
    const [values, setValues] = useState<Record<string, Value>>({});
    const [title, setTitle] = useState('');
    const importRef = useRef<HTMLInputElement>(null);
    const modalRef = useRef<HTMLDialogElement>(null);
    const [commandRevision, setCommandRevision] = useState(snapshot.revision);
    const [commandTarget, setCommandTarget] = useState('');
    const [commandActor, setCommandActor] = useState('');
    const [commandError, setCommandError] = useState('');
    useEffect(() => {
        if (!dialog) return;
        const trigger = document.activeElement;
        const modal = modalRef.current;
        modal?.showModal();
        return () => {
            modal?.close();
            if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
        };
    }, [dialog]);
    const definition = product.kinds.find(item => item.key === kind);
    const rows = useMemo(() => queryEntities(snapshot, kind, query, status), [snapshot, kind, query, status]);
    const selected = snapshot.entities.find(entity => entity.id === selectedId);
    const available = selected ? product.operations.filter(item => item.kind === selected.kind && item.from.includes(selected.status) && item.roles.includes(product.actors.find(actor => actor.id === actorId)?.role ?? '')) : [];
    useEffect(() => {
        if (!rows.some(row => row.id === selectedId))
            setSelectedId(rows[0]?.id ?? '');
    }, [rows, selectedId]);
    useEffect(() => {
        const sync = (event: StorageEvent) => {
            if (event.key === repository.key)
                setSnapshot(repository.read());
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, [repository]);
    const commit = (command: Parameters<Repository['commit']>[0]) => {
        try {
            const next = repository.commit(command, new Date().toISOString());
            setSnapshot(next);
            setNotice(next.audit.at(-1)?.summary ?? 'Saved.');
            setDialog(null);
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : 'Operation failed.');
            setCommandError(error instanceof Error ? error.message : 'Operation failed.');
        }
    };
    const openCreate = () => { setValues(initialValues(definition?.fields ?? [])); setTitle(''); setDialog('create'); };
    const openEdit = () => {
        if (!selected)
            return;
        setValues({ ...selected.fields });
        setTitle(selected.title);
        setDialog('edit');
    };
    const openOperation = (key: string, targetId = selectedId) => {
        const selectedOperation = product.operations.find(item => item.key === key);
        setCommandRevision(snapshot.revision); setCommandTarget(targetId); setCommandActor(actorId); setCommandError('');
        setOperation(key); setValues(initialValues(selectedOperation?.fields ?? [])); setDialog('operate');
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const id = crypto.randomUUID();
        if (dialog === 'create')
            commit({ id, expectedRevision: snapshot.revision, actorId, type: 'create', kind, title, input: values });
        else if (dialog === 'edit' && selected)
            commit({ id, expectedRevision: snapshot.revision, actorId, type: 'edit', entityId: selected.id, title, input: values });
        else if (dialog === 'operate')
            commit({ id, expectedRevision: commandRevision, actorId: commandActor, type: 'operate', entityId: commandTarget, operation, input: values });
    };
    const formFields = dialog === 'operate' ? product.operations.find(item => item.key === operation)?.fields ?? [] : definition?.fields ?? [];
    const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file)
            return;
        try {
            setSnapshot(repository.restore(await file.text(), snapshot.revision, actorId, new Date().toISOString()));
            setNotice('Validated backup restored.');
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : 'Restore failed.');
        }
        finally {
            event.target.value = '';
        }
    };
    return <div className="app" style={{ '--accent': product.accent } as React.CSSProperties}>
    <header><div className="brand"><span>{product.name.slice(0, 1)}</span><div><strong>{product.name}</strong><small>{product.description}</small></div></div><label className="actor">Working as<select aria-label="Current actor" value={actorId} onChange={event => setActorId(event.target.value)}>{product.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name} · {actor.role}</option>)}</select></label></header>
    <div className="layout"><aside><p>Operations</p>{product.kinds.map(item => <button key={item.key} className={kind === item.key ? 'active' : ''} onClick={() => { setKind(item.key); setStatus(''); }}><span>{item.label}</span><b>{snapshot.entities.filter(entity => entity.kind === item.key).length}</b></button>)}<div className="aside-actions"><button onClick={() => download(product.name + '-backup.json', JSON.stringify(snapshot, null, 2), 'application/json')}>Export backup</button><button onClick={() => importRef.current?.click()}>Restore backup</button><input ref={importRef} hidden type="file" accept="application/json" onChange={event => void importBackup(event)}/></div></aside>
      <main><section className="hero"><div><small>LIVE WORKSPACE · REVISION {snapshot.revision}</small><h1>{definition?.label}</h1><p>Connected records, guarded commands, durable history.</p></div><button className="primary" onClick={openCreate}>Create {definition?.label.toLowerCase()}</button></section>
        <section className="metrics">{product.metrics(snapshot.entities).map(metric => <article key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong></article>)}</section>
        {notice && <p role="status" className="notice">{notice}</p>}
        <section className="workspace"><div className="list"><div className="filters"><input aria-label="Search records" placeholder="Search records…" value={query} onChange={event => setQuery(event.target.value)}/><select aria-label="Filter status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All states</option>{definition?.states.map(item => <option key={item}>{item}</option>)}</select><button title="Export current view" onClick={() => download(kind + '.csv', csv(rows), 'text/csv')}>CSV</button></div>{rows.map(row => <button className={selectedId === row.id ? 'row selected' : 'row'} key={row.id} onClick={() => setSelectedId(row.id)}><span><strong>{row.title}</strong><small>{row.id} · r{row.revision}</small></span><em>{row.status}</em></button>)}{rows.length === 0 && <p className="empty">No records match this view.</p>}</div>
          <div className="detail">{selected ? <><div className="detail-title"><div><small>{selected.kind.toUpperCase()}</small><h2>{selected.title}</h2></div><span>{selected.status}</span></div><dl>{definition?.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{display(selected.fields[field.key], snapshot.entities)}</dd></div>)}</dl><div className="toolbar"><button onClick={openEdit}>Edit draft</button>{available.map(item => <button className="primary" key={item.key} onClick={() => openOperation(item.key)}>{item.label}</button>)}</div><Linked entity={selected} snapshot={snapshot}/><History entity={selected} snapshot={snapshot}/></> : <p className="empty">Choose a record to inspect it.</p>}</div></section>
      </main></div>
    {dialog && <dialog ref={modalRef} aria-labelledby="command-title" onCancel={() => setDialog(null)}><form className="modal" onSubmit={submit}><div><h2 id="command-title">{dialog === 'operate' ? product.operations.find(item => item.key === operation)?.label : dialog === 'create' ? 'Create record' : 'Edit draft'}</h2><button type="button" aria-label="Close dialog" onClick={() => setDialog(null)}>×</button></div>{dialog !== 'operate' && <label>Record title<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)}/></label>}{formFields.map(field => <Editor key={field.key} field={field} value={values[field.key]} entities={snapshot.entities} onChange={value => setValues(current => ({ ...current, [field.key]: value }))}/>)}{commandError && <p role="alert">{commandError}</p>}{dialog === 'operate' && <button type="button" onClick={() => { const latest = repository.read(); setSnapshot(latest); setCommandRevision(latest.revision); setCommandError(''); }}>Refresh records and retain input</button>}<button className="primary" type="submit">Save command</button></form></dialog>}
  </div>;
}
function display(value: Value | undefined, entities: Entity[]) {
    if (typeof value === 'number')
        return new Intl.NumberFormat('en-US').format(value);
    return entities.find(entity => entity.id === value)?.title ?? String(value ?? '—');
}
function Editor({ field, value, entities, onChange }: {
    field: Field;
    value: Value | undefined;
    entities: Entity[];
    onChange: (value: Value) => void;
}) {
    if (field.type === 'select' || field.type === 'reference')
        return <label>{field.label}<select required={field.required} value={String(value ?? '')} onChange={event => onChange(event.target.value)}><option value="">Select…</option>{(field.type === 'select' ? field.options ?? [] : entities.filter(entity => entity.kind === field.reference).map(entity => entity.id)).map(option => <option key={option} value={option}>{entities.find(entity => entity.id === option)?.title ?? option}</option>)}</select></label>;
    const inputValue = typeof value === 'boolean' ? String(value) : value ?? '';
    return <label>{field.label}<input required={field.required} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} min={field.min} max={field.max} step={field.integer ? 1 : undefined} value={inputValue} onChange={event => onChange(field.type === 'number' ? event.target.valueAsNumber : event.target.value)}/></label>;
}
function Linked({ entity, snapshot }: {
    entity: Entity;
    snapshot: Snapshot;
}) { const linked = linkedRecords(snapshot, product, entity.id); return <section className="sub"><h3>Linked records <span>{linked.length}</span></h3>{linked.slice(0, 8).map(item => <p key={item.id}><b>{item.title}</b><small>{item.kind} · {item.status}</small></p>)}{linked.length === 0 && <small>No inbound links yet.</small>}</section>; }
function History({ entity, snapshot }: {
    entity: Entity;
    snapshot: Snapshot;
}) { const events = snapshot.audit.filter(event => event.entityIds.includes(entity.id)).toReversed().slice(0, 8); return <section className="sub"><h3>Audit history <span>{events.length}</span></h3>{events.map(event => <p key={event.id}><b>{event.summary}</b><small>{event.actor} · {new Date(event.at).toLocaleString()}</small></p>)}{events.length === 0 && <small>No commands recorded yet.</small>}</section>; }
