export interface TimelineItem {
    id: string;
    title: string;
    detail: string;
    at: string;
}
export function Timeline({ items }: {
    items: readonly TimelineItem[];
}) { return <ol className="suite-timeline">{items.map(item => <li key={item.id}><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time><b>{item.title}</b><span>{item.detail}</span></li>)}</ol>; }
