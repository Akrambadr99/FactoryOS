export interface SavedReport {
    id: string;
    name: string;
    kind: string;
    statuses: string[];
    ownerId: string;
    updatedAt: string;
}
export class SavedReportCatalog {
    private readonly reports: SavedReport[];
    constructor(reports: SavedReport[] = []) { this.reports = reports.map(report => ({ ...report, statuses: [...report.statuses] })); }
    list(ownerId: string) { return this.reports.filter(report => report.ownerId === ownerId).map(report => ({ ...report, statuses: [...report.statuses] })); }
    save(report: SavedReport) {
        const index = this.reports.findIndex(item => item.id === report.id);
        if (index >= 0)
            this.reports[index] = { ...report, statuses: [...report.statuses] };
        else
            this.reports.push({ ...report, statuses: [...report.statuses] });
    }
    remove(id: string) {
        const index = this.reports.findIndex(report => report.id === id);
        if (index >= 0)
            this.reports.splice(index, 1);
    }
}
