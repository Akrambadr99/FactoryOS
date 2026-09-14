export function CountBadge({ value }: {
    value: number;
}) { return <b className="count-badge" aria-label={String(value) + ' records'}>{value}</b>; }
