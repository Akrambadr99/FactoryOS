export type NotificationLevel = 'info' | 'warning' | 'critical';
export interface Notification {
    id: string;
    title: string;
    detail: string;
    level: NotificationLevel;
    createdAt: string;
    readAt?: string;
}
export class NotificationCenter {
    private items: Notification[];
    constructor(items: Notification[] = []) { this.items = items.map(item => ({ ...item })); }
    list() { return this.items.map(item => ({ ...item })); }
    unread() { return this.items.filter(item => item.readAt === undefined).length; }
    push(item: Notification) {
        if (!this.items.some(existing => existing.id === item.id))
            this.items.unshift({ ...item });
    }
    read(id: string, at: string) {
        const item = this.items.find(notification => notification.id === id);
        if (item)
            item.readAt = at;
    }
}
