export interface TrendPoint {
    period: string;
    value: number;
}
export function trend(points: readonly TrendPoint[]) {
    if (points.length < 2)
        return { change: 0, direction: 'flat' as const };
    const change = (points[points.length - 1]?.value ?? 0) - (points[0]?.value ?? 0);
    return { change, direction: change > 0 ? 'up' as const : change < 0 ? 'down' as const : 'flat' as const };
}
export function movingAverage(points: readonly TrendPoint[], window: number): TrendPoint[] { return points.map((point, index) => { const slice = points.slice(Math.max(0, index - window + 1), index + 1); return { period: point.period, value: slice.reduce((sum, item) => sum + item.value, 0) / slice.length }; }); }
