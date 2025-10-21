import type { FileManifest, InitResult, UploadAdapter } from "./adapter";
import { maskUrl, isUploadDebugEnabled } from "@/lib/debug";

function getHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  return h;
}

export class S3Adapter implements UploadAdapter {
  base = import.meta.env.VITE_API_BASE_URL || "";

  async createAlbum(): Promise<{ albumId: string }> {
    if (!this.base) throw new Error("VITE_API_BASE_URL is not set");
    if (isUploadDebugEnabled()) console.debug("[S3] createAlbum", { base: this.base });
    const res = await fetch(`${this.base}/albums`, { method: "POST", headers: getHeaders() });
    const data = await res.json();
    return { albumId: data.album_id || data.albumId };
  }

  async submitManifest(albumId: string, manifest: FileManifest[]): Promise<{ serverFiles: { client_id: string; file_id: string }[] }> {
    if (isUploadDebugEnabled()) console.debug("[S3] submitManifest", { albumId, count: manifest.length });
    const res = await fetch(`${this.base}/upload/manifest`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ album_id: albumId, files: manifest }),
    });
    return await res.json();
  }

  async initMultipart(file_id: string, size: number): Promise<InitResult> {
    if (isUploadDebugEnabled()) console.debug("[S3] initMultipart", { file_id, size });
    const res = await fetch(`${this.base}/upload/multipart/init`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ file_id, size }),
    });
    return await res.json();
  }

  async getPartUrl(uploadId: string, partNumber: number, key: string): Promise<string> {
    const u = new URL(`${this.base}/upload/multipart/part-url`);
    u.searchParams.set("upload_id", uploadId);
    u.searchParams.set("part_number", String(partNumber));
    u.searchParams.set("key", key);
    const res = await fetch(u.toString(), { headers: getHeaders() });
    const data = await res.json();
    if (isUploadDebugEnabled()) console.debug("[S3] part-url", { partNumber, masked: maskUrl(data.url) });
    return data.url;
  }

  async completeMultipart(uploadId: string, key: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    if (isUploadDebugEnabled()) console.debug("[S3] finalize", { uploadId, key, partsCount: parts.length });
    const res = await fetch(`${this.base}/upload/multipart/complete`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ upload_id: uploadId, key, parts }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`complete failed ${res.status} ${text}`.trim());
    }
    if (isUploadDebugEnabled()) console.debug("[S3] complete ok", { key });
  }
}


