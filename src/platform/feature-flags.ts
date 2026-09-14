export interface FeatureFlag {
    key: string;
    enabled: boolean;
    roles?: readonly string[];
    percentage?: number;
}
export function isFeatureEnabled(flag: FeatureFlag, role: string, subject: string): boolean {
    if (!flag.enabled)
        return false;
    if (flag.roles && !flag.roles.includes(role))
        return false;
    if (flag.percentage === undefined)
        return true;
    const bucket = Array.from(subject).reduce((total, char) => total + char.charCodeAt(0), 0) % 100;
    return bucket < flag.percentage;
}
