export function ProgressMeter({ label, value }: {
    label: string;
    value: number;
}) { const safe = Math.min(100, Math.max(0, value)); return <div className="suite-meter"><span>{label}<b>{safe}%</b></span><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}><i style={{ width: String(safe) + '%' }}/></div></div>; }
