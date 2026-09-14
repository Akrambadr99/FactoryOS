export interface RetryPolicy {
    attempts: number;
    baseDelayMs: number;
    maximumDelayMs: number;
}
export function retryDelay(attempt: number, policy: RetryPolicy) { return Math.min(policy.maximumDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1)); }
export async function withRetry<T>(operation: () => Promise<T>, policy: RetryPolicy, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
    let failure: unknown;
    for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            failure = error;
            if (attempt < policy.attempts)
                await wait(retryDelay(attempt, policy));
        }
    }
    throw failure;
}
