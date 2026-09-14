export function StatePill({ value }: {
    value: string;
}) { return <span className="suite-pill" data-status={value.toLowerCase().replaceAll(' ', '-')}>{value}</span>; }
