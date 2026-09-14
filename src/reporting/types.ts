export interface ReportColumn<T> {
    key: string;
    label: string;
    value: (row: T) => string | number;
}
export interface Report<T> {
    title: string;
    generatedAt: string;
    columns: readonly ReportColumn<T>[];
    rows: readonly T[];
    summary: Record<string, string | number>;
}
