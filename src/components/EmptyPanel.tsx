export function EmptyPanel({ title, detail }: {
    title: string;
    detail: string;
}) { return <div className="suite-empty"><strong>{title}</strong><p>{detail}</p></div>; }
