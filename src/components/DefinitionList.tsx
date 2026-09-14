export function DefinitionList({ items }: {
    items: readonly {
        label: string;
        value: string;
    }[];
}) { return <dl className="suite-definitions">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>; }
