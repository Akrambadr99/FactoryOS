export interface OutboxMessage {
    readonly id: string;
    readonly topic: string;
    readonly payload: unknown;
    readonly createdAt: string;
    attempts: number;
    sentAt?: string;
}
export class Outbox {
    private readonly messages: OutboxMessage[] = [];
    enqueue(message: OutboxMessage) {
        if (!this.messages.some(item => item.id === message.id))
            this.messages.push({ ...message });
    }
    pending() { return this.messages.filter(item => item.sentAt === undefined).map(item => ({ ...item })); }
    attempt(id: string) {
        const item = this.messages.find(message => message.id === id);
        if (item)
            item.attempts += 1;
    }
    markSent(id: string, at: string) {
        const item = this.messages.find(message => message.id === id);
        if (item)
            item.sentAt = at;
    }
    size() { return this.pending().length; }
}
