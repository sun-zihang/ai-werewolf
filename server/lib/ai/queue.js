// 按厂商的并发限制与最小间隔（防止触发服务商限流）
const RUNNING = new Map();
const LAST_CALL = new Map();
const WAITERS = new Map();
const MAX_CONCURRENCY = 2;
const MIN_GAP_MS = 120;
async function acquire(key) {
    for (;;) {
        const running = RUNNING.get(key) ?? 0;
        const last = LAST_CALL.get(key) ?? 0;
        const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
        if (running < MAX_CONCURRENCY && wait === 0) {
            RUNNING.set(key, running + 1);
            return;
        }
        await new Promise((resolve) => {
            const list = WAITERS.get(key) ?? [];
            list.push(resolve);
            WAITERS.set(key, list);
            setTimeout(resolve, Math.max(50, wait || 50));
        });
    }
}
function release(key) {
    const running = (RUNNING.get(key) ?? 1) - 1;
    RUNNING.set(key, running);
    LAST_CALL.set(key, Date.now());
    const waiters = WAITERS.get(key) ?? [];
    if (waiters.length) {
        const next = waiters.shift();
        WAITERS.set(key, waiters);
        if (next)
            next();
    }
}
export async function withRateLimit(key, fn) {
    await acquire(key);
    try {
        return await fn();
    }
    finally {
        release(key);
    }
}
