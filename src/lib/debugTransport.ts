import { isUploadDebugEnabled, maskUrl } from "@/lib/debug";

type LogEvent = any;

let buffer: LogEvent[] = [];
let timer: number | undefined;

function ship() {
  if (!buffer.length) return;
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const payload = buffer.splice(0, buffer.length);
  fetch(`${base}/debug/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "upload-debug-batch", events: payload }),
  }).catch(() => {});
}

export function logUploadEventToServer(e: any) {
  if (!isUploadDebugEnabled()) return;
  try {
    const clone = { ...e };
    if (clone.url) clone.url = maskUrl(clone.url);
    buffer.push(clone);
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(ship, 250);
  } catch {}
}

export function flushUploadDebug() {
  if (!isUploadDebugEnabled()) return;
  try { ship(); } catch {}
}





