import type { ReactNode } from 'react';
export function Notice({ children, tone = 'info' }: {
    children: ReactNode;
    tone?: 'info' | 'warning' | 'success';
}) { return <p className={'suite-notice ' + tone} role="status">{children}</p>; }
