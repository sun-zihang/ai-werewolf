export declare function withRateLimit<T>(key: string, fn: () => Promise<T>): Promise<T>;
