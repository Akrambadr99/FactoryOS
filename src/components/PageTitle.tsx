import type { ReactNode } from 'react';
export function PageTitle({ eyebrow, title, detail, actions }: {
    eyebrow: string;
    title: string;
    detail: string;
    actions?: ReactNode;
}) { return <header className="suite-title"><div className="suite-title-copy"><small>{eyebrow}</small><h1>{title}</h1><p>{detail}</p></div>{actions && <div className="suite-title-actions">{actions}</div>}</header>; }
