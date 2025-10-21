export type FileManifest = {
  client_id: string;
  name: string;
  bytes: number;
  mime: string;
  sha1: string;
  taken_at?: string | null;
  gps?: { lat: number; lon: number } | null;
};

export type InitResult = { uploadId: string; key: string };

export interface UploadAdapter {
  createAlbum(): Promise<{ albumId: string }>;
  submitManifest(albumId: string, manifest: FileManifest[]): Promise<{ serverFiles: { client_id: string; file_id: string }[] }>;
  initMultipart(file_id: string, size: number): Promise<InitResult>;
  getPartUrl(uploadId: string, partNumber: number, key: string): Promise<string>;
  completeMultipart(uploadId: string, key: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
}

export async function getUploadAdapter(): Promise<UploadAdapter> {
  const mode = (import.meta.env.VITE_UPLOAD_MODE || "mock").toLowerCase();
  if (mode === "s3") {
    const mod = await import("./adapter.s3");
    return new mod.S3Adapter();
  } else {
    const mod = await import("./adapter.mock");
    return new mod.MockAdapter();
  }
}


