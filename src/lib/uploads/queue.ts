import type { FileManifest, UploadAdapter } from "./adapter";
import { isUploadDebugEnabled } from "@/lib/debug";

type QueueOptions = { concurrency?: number; partSizeBytes?: number; maxRetries?: number; onEvent?: (e: any) => void };

type ManifestWithServer = FileManifest & { __file: File; server_file_id: string };

export function createUploadQueue(adapter: UploadAdapter, opts: QueueOptions = {}) {
  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? 4));
  const partSize = opts.partSizeBytes ?? 8 * 1024 * 1024; // 8MB
  const maxRetries = opts.maxRetries ?? 3;
  const { onEvent } = opts;

  async function uploadFile(manifest: ManifestWithServer) {
    onEvent?.({ type: "init:start", id: manifest.server_file_id, bytes: manifest.bytes });
    if (isUploadDebugEnabled()) console.debug("[S3] stage:init", { id: manifest.server_file_id, bytes: manifest.bytes });
    const init = await adapter.initMultipart(manifest.server_file_id, manifest.bytes);
    onEvent?.({ type: "init:ok", id: manifest.server_file_id, uploadId: init.uploadId, key: init.key });
    if (isUploadDebugEnabled()) console.debug("[S3] stage:init:ok", { uploadId: init.uploadId, key: init.key });
    const file = (manifest as any).file as File | undefined;
    if (!file) return;
    const parts: { partNumber: number; etag: string }[] = [];
    const totalParts = Math.ceil(file.size / partSize);
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const start = i * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      let attempt = 0;
      let etag = "";
      while (attempt < maxRetries) {
        try {
          onEvent?.({ type: "part:sign", partNumber, id: manifest.server_file_id });
          const url = await adapter.getPartUrl(init.uploadId, partNumber, init.key);
          onEvent?.({ type: "part:url", partNumber, id: manifest.server_file_id, url });
          if (isUploadDebugEnabled()) console.debug("[S3] stage:part:url", { partNumber });
          // For mock, simulate delay; for s3, PUT the part
          if (url.startsWith("mock://")) {
            await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
            etag = `W/"mock-${partNumber}"`;
          } else {
            const res = await fetch(url, { method: "PUT", body: blob });
            if (!res.ok) throw new Error("upload failed");
            const hdr = res.headers.get("ETag") || res.headers.get("etag") || "";
            etag = hdr.replaceAll('"', "") || `part-${partNumber}`;
            if (isUploadDebugEnabled()) console.debug("[S3] stage:part:put:ok", { partNumber, etag });
          }
          parts.push({ partNumber, etag });
          onEvent?.({ type: "part:put:ok", partNumber, id: manifest.server_file_id, etag });
          break;
        } catch (e) {
          attempt += 1;
          if (attempt >= maxRetries) throw e;
          await new Promise((r) => setTimeout(r, attempt * 400));
        }
      }
    }
    onEvent?.({ type: "complete:start", id: manifest.server_file_id });
    if (isUploadDebugEnabled()) console.debug("[S3] finalize:begin", { uploadId: init.uploadId, key: init.key, partsCount: parts.length });
    // Finalize with timeout and 1 retry
    const FINALIZE_TIMEOUT_MS = 60_000;
    let finalizeAttempt = 0;
    while (finalizeAttempt < 2) {
      try {
        const finalize = adapter.completeMultipart(init.uploadId, init.key, parts);
        await Promise.race([
          finalize,
          new Promise((_, rej) => setTimeout(() => rej(new Error("Finalize timeout")), FINALIZE_TIMEOUT_MS)),
        ]);
        break;
      } catch (e) {
        finalizeAttempt += 1;
        if (finalizeAttempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 800 * finalizeAttempt));
      }
    }
    if (isUploadDebugEnabled()) console.info("[S3] file done", { name: (manifest as any).name, key: init.key });
    onEvent?.({ type: "complete:ok", id: manifest.server_file_id, key: init.key });
  }

  async function uploadAll(manifests: ManifestWithServer[]) {
    // attach original file to manifest for slicing
    const withFiles = manifests.map((m: any) => ({ ...m, file: (m.__file as File) || m.file }));
    const queue = withFiles.slice();
    let active = 0;
    let idx = 0;
    return await new Promise<void>((resolve, reject) => {
      const next = () => {
        while (active < concurrency && idx < queue.length) {
          const cur = queue[idx++];
          active += 1;
          uploadFile(cur)
            .then(() => {
              active -= 1;
              if (idx >= queue.length && active === 0) resolve();
              else next();
            })
            .catch(reject);
        }
      };
      next();
    });
  }

  return {
    async uploadAll(manifests: ManifestWithServer[]) {
      await (await Promise.resolve(uploadAll(manifests)));
      if (isUploadDebugEnabled()) console.info("[S3] all files done");
    },
  };
}


