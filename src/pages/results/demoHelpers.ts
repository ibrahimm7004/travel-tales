export type PostUploadStatus = {
  albumId: string;
  status: string;
  progress: number;
  error?: string | null;
  error_log_excerpt?: string | null;
  counts?: Record<string, number>;
  workspace_rel_paths?: Record<string, string>;
};

export type TextPreview = {
  text: string;
  truncated: boolean;
  lineCount: number;
  byteCount: number;
};

export function resolveAlbumIdFromQueryOrSession(search: string): string | null {
  const queryId = new URLSearchParams(search).get("albumId");
  if (queryId && queryId.trim()) {
    return queryId.trim();
  }
  const raw = sessionStorage.getItem("lastUpload");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.albumId === "string" && parsed.albumId ? parsed.albumId : null;
  } catch {
    return null;
  }
}

export function withAlbumId(path: string, albumId: string | null): string {
  if (!albumId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}albumId=${encodeURIComponent(albumId)}`;
}

export function buildAssetUrl(base: string, albumId: string, rel: string): string {
  return `${base}/processing/post-upload/asset?albumId=${encodeURIComponent(albumId)}&rel=${encodeURIComponent(rel)}`;
}

// DEMO ONLY, safe to delete.
export function buildDemoAssetUrl(base: string, albumId: string, rel: string): string {
  const baseUrl = buildAssetUrl(base, albumId, rel);
  return `${baseUrl}&demo=1&w=640&q=68&fmt=webp`;
}

async function probeOne(base: string, albumId: string, rel: string): Promise<boolean> {
  const url = buildAssetUrl(base, albumId, rel);
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return true;
    if (head.status !== 405 && head.status !== 501) return false;
  } catch {
    // fall through to GET
  }
  try {
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    if (res.body) {
      try {
        await res.body.cancel();
      } catch {
        // ignore
      }
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function probeAssetPaths(base: string, albumId: string, rels: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const seen = new Set<string>();
  const unique = rels.filter((rel) => {
    if (seen.has(rel)) return false;
    seen.add(rel);
    return true;
  });
  for (const rel of unique) {
    out[rel] = await probeOne(base, albumId, rel);
  }
  return out;
}

export function isTextArtifact(rel: string): boolean {
  const lower = rel.toLowerCase();
  return (
    lower.endsWith(".json")
    || lower.endsWith(".jsonl")
    || lower.endsWith(".txt")
    || lower.endsWith(".log")
    || lower.endsWith(".md")
    || lower.endsWith(".csv")
  );
}

function capByLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text, truncated: false };
  }
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true };
}

export async function fetchTextPreview(
  base: string,
  albumId: string,
  rel: string,
  maxLines = 200,
  maxBytes = 50 * 1024,
): Promise<TextPreview> {
  const url = buildAssetUrl(base, albumId, rel);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to load ${rel}`);
  }

  const decoder = new TextDecoder("utf-8");
  let raw = "";
  let bytes = 0;
  let truncated = false;

  if (res.body) {
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const allowed = Math.max(0, maxBytes - bytes);
      if (allowed <= 0) {
        truncated = true;
        break;
      }
      const chunk = value.length > allowed ? value.slice(0, allowed) : value;
      bytes += chunk.length;
      raw += decoder.decode(chunk, { stream: true });
      if (value.length > allowed) {
        truncated = true;
        break;
      }
      if (raw.split(/\r?\n/).length > maxLines) {
        truncated = true;
        break;
      }
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    raw += decoder.decode();
  } else {
    raw = await res.text();
    bytes = new TextEncoder().encode(raw).length;
    if (bytes > maxBytes) truncated = true;
  }

  const lineCapped = capByLines(raw, maxLines);
  if (lineCapped.truncated) truncated = true;
  let text = lineCapped.text;
  let byteCount = new TextEncoder().encode(text).length;
  if (byteCount > maxBytes) {
    text = decoder.decode(new TextEncoder().encode(text).slice(0, maxBytes));
    byteCount = maxBytes;
    truncated = true;
  }

  return {
    text,
    truncated,
    lineCount: text ? text.split(/\r?\n/).length : 0,
    byteCount,
  };
}
