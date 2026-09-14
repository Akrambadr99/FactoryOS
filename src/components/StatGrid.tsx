export function StatGrid({ items }: {
    items: readonly {
        label: string;
        value: string;
    }[];
}) { return <div className="suite-stats">{items.map(item => <article key={item.label}><small>{item.label}</small><strong>{item.value}</strong></article>)}</div>; }
