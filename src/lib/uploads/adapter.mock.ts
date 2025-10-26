import type { FileManifest, InitResult, UploadAdapter } from "./adapter";

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class MockAdapter implements UploadAdapter {
  async createAlbum(): Promise<{ albumId: string }> {
    return { albumId: uuid() };
  }

  async submitManifest(_albumId: string, manifest: FileManifest[]): Promise<{ serverFiles: { client_id: string; file_id: string }[] }> {
    return {
      serverFiles: manifest.map((m) => ({ client_id: m.client_id, file_id: uuid() })),
    };
  }

  async initMultipart(_file_id: string, _size: number): Promise<InitResult> {
    return { uploadId: uuid(), key: uuid() };
  }

  async getPartUrl(uploadId: string, partNumber: number): Promise<string> {
    return `mock://${uploadId}/${partNumber}`;
  }

  async completeMultipart(_uploadId: string, _key: string, _parts: { partNumber: number; etag: string }[]): Promise<void> {
    return;
  }
}







