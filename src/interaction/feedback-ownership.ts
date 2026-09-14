export interface OwnedFeedback<T> {
    requestId: string;
    ownerId: string;
    status: 'pending' | 'success' | 'error';
    value?: T;
    message?: string;
}
export function startFeedback<T>(items: readonly OwnedFeedback<T>[], requestId: string, ownerId: string): OwnedFeedback<T>[] { return [...items.filter(item => item.requestId !== requestId), { requestId, ownerId, status: 'pending' }]; }
export function finishFeedback<T>(items: readonly OwnedFeedback<T>[], requestId: string, result: {
    value: T;
} | {
    message: string;
}): OwnedFeedback<T>[] { return items.map(item => item.requestId !== requestId ? item : 'value' in result ? { ...item, status: 'success', value: result.value } : { ...item, status: 'error', message: result.message }); }
export function feedbackFor<T>(items: readonly OwnedFeedback<T>[], ownerId: string) { return items.filter(item => item.ownerId === ownerId); }
