import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import OliveLoader from "@/components/OliveLoader";
import { isUploadDebugEnabled, maskUrl } from "@/lib/debug";
import { logUploadEventToServer, flushUploadDebug } from "@/lib/debugTransport";
import UploadDebugPanel from "@/dev/UploadDebugPanel";
import S3Panel from "@/components/dev/S3Panel";
import { createManifestBatch } from "@/lib/uploads/manifest";
import { createUploadQueue } from "@/lib/uploads/queue";
import { getUploadAdapter } from "@/lib/uploads/adapter";

export default function UploadPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isUploading, setIsUploading] = useState(false);
  const debug = isUploadDebugEnabled();
  const [events, setEvents] = useState<any[]>([]);
  const [completedKeys, setCompletedKeys] = useState<string[]>([]);

  const onFiles = useCallback(async (files: FileList | File[]) => {
    if (!files || ("length" in files && files.length === 0)) return;
    setIsUploading(true);
    const adapter = await getUploadAdapter();
    const { albumId } = await adapter.createAlbum();
    const fileArray = Array.from(files as FileList);
    let manifests;
    try {
      manifests = await createManifestBatch(fileArray);
    } catch (err) {
      console.error("Failed to hash files (WebCrypto)", err);
      // fallback: create minimal manifests without sha1
      manifests = fileArray.map((f: File) => ({
        client_id: crypto.randomUUID(),
        name: f.name,
        bytes: f.size,
        mime: f.type || "application/octet-stream",
        sha1: "",
        taken_at: null,
        gps: null,
        __file: f,
      }));
    }
    const res = await adapter.submitManifest(albumId, manifests);
    const byClient = new Map(res.serverFiles.map((x) => [x.client_id, x.file_id]));
    const enriched = manifests.map((m: any) => ({ ...m, server_file_id: byClient.get(m.client_id)!, __file: (m as any).__file }));
    const queue = createUploadQueue(adapter, {
      concurrency: 4,
      onEvent: (e) => {
        if (debug) {
          const payload = e?.url ? { ...e, url: maskUrl(e.url) } : e;
          console.debug("[UPLOAD]", payload);
          logUploadEventToServer(payload);
          setEvents((prev) => (prev.length > 300 ? prev.slice(-300).concat(payload) : prev.concat(payload)));
        }
        if (e?.type === "complete:ok" && e?.key) {
          setCompletedKeys((prev) => prev.concat(e.key));
        }
      },
    });
    await queue.uploadAll(enriched as any);
    if (debug) {
      try {
        const base = import.meta.env.VITE_API_BASE_URL || "";
        const completes = events.filter((ev) => ev.type === "complete:ok");
        const keys = completes.slice(0, 3).map((ev) => ev.key);
        if (keys.length === 0) console.debug("[VERIFY] No complete events recorded; cannot verify.");
        for (const key of keys) {
          const getUrlRes = await fetch(`${base}/upload/signed-get-url?key=${encodeURIComponent(key)}`);
          const { url } = await getUrlRes.json();
          console.debug("[VERIFY] signed GET url", { masked: maskUrl(url) });
          const headRes = await fetch(`${base}/upload/head?key=${encodeURIComponent(key)}`);
          const headJson = await headRes.json();
          console.debug("[VERIFY] head", { key, head: headJson });
        }
      } catch (err) {
        console.debug("[VERIFY] error", err);
      }
      // ensure last batch printed to server
      flushUploadDebug();
    }
    sessionStorage.setItem("lastUpload", JSON.stringify({ albumId, count: manifests.length, keys: completedKeys.slice(-20) }));
    navigate("/processing");
  }, [navigate]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) onFiles(e.target.files);
  }, [onFiles]);

  if (isUploading) {
    return (
      <div data-testid="upload-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
        <div className="max-w-3xl w-full">
          <div className="bg-card/90 rounded-2xl shadow-vintage p-10 border border-border text-center">
            <h2 className="text-2xl font-semibold mb-4" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Uploading your images…</h2>
            <OliveLoader testId="upload-loader" subline="This may take a few minutes for large batches." />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="upload-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        <div
          data-testid="upload-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="bg-[#F9F9F5] rounded-2xl p-10 border border-[#A7B580] shadow-vintage text-center"
        >
          <h2 className="text-2xl font-semibold mb-3" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Drop your trip here</h2>
          <p className="text-[#4F6420]/80 mb-6">JPEG, PNG, WEBP, HEIC/HEIF</p>
          <label className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] cursor-pointer hover:bg-[#E8EBD1]">
            Choose files
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="hidden" onChange={onPick} />
          </label>
        </div>
        {debug ? <UploadDebugPanel feed={events} /> : null}
        {/* Hidden S3 debug panel */}
        <S3Panel albumPrefix={completedKeys.length ? completedKeys[0].split("/").slice(0, -1).join("/") + "/" : undefined}
                 sampleKeys={completedKeys.slice(-5)} />
      </div>
    </div>
  );
}


