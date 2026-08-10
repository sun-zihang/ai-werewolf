import { useEffect, useState } from "react";

// 全局后端离线状态：App 启动时探测 /api/health，各页面订阅以展示友好提示
let offline = false;
const subs = new Set<(v: boolean) => void>();

export function setOffline(v: boolean) {
  offline = v;
  subs.forEach((fn) => fn(v));
}

export function isOffline(): boolean {
  return offline;
}

export function useOffline(): boolean {
  const [v, setV] = useState(offline);
  useEffect(() => {
    const fn = (next: boolean) => setV(next);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return v;
}