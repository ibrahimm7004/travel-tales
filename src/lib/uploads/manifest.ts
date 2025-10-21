import type { FileManifest } from "./adapter";

async function sha1OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  if (!(crypto as any)?.subtle) {
    throw new Error("WebCrypto not available");
  }
  const digest = await crypto.subtle.digest("SHA-1", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createManifestBatch(files: File[]): Promise<(FileManifest & { __file: File })[]> {
  const out: (FileManifest & { __file: File })[] = [];
  for (const f of files) {
    const sha1 = await sha1OfFile(f);
    out.push({
      client_id: crypto.randomUUID(),
      name: f.name,
      bytes: f.size,
      mime: f.type || "application/octet-stream",
      sha1,
      taken_at: null,
      gps: null,
      __file: f,
    });
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}


