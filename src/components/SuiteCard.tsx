import type { ReactNode } from 'react';
export function SuiteCard({ title, detail, children }: {
    title: string;
    detail?: string;
    children?: ReactNode;
}) { return <section className="suite-card"><h2>{title}</h2>{detail ? <p>{detail}</p> : null}{children}</section>; }
