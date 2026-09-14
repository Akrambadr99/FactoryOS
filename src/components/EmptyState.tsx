import type { ReactNode } from 'react';
export function EmptyState({ title, detail, action }: {
    title: string;
    detail: string;
    action?: ReactNode;
}) { return <section className="suite-empty"><h3>{title}</h3><p>{detail}</p>{action}</section>; }
