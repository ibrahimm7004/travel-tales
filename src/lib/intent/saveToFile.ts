import type { TripIntent } from "./parseTripIntent";

function resolveApiBase(): string {
  const envBase = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  if (envBase) return envBase.replace(/\/+$/, "");
  // Default to common FastAPI dev port
  return "http://localhost:8000";
}

export async function saveIntentToFile(raw: string, intent: TripIntent) {
  const body = { ts: new Date().toISOString(), raw, intent };
  const base = resolveApiBase();
  const url = `${base}/api/dev/intent-save`;

  const res = await fetch(url, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!res.ok) {
    if ((import.meta as any).env?.VITE_DEBUG_INTENT === '1') {
      // eslint-disable-next-line no-console
      console.warn("[intent-save] backend returned", res.status);
    }
  } else {
    if ((import.meta as any).env?.VITE_DEBUG_INTENT === '1') {
      // eslint-disable-next-line no-console
      console.info("[intent-save] wrote via backend", await res.json());
    }
  }
}
