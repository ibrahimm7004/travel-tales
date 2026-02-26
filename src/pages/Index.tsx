import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { createManifestBatch } from "@/lib/uploads/manifest";
import { createUploadQueue } from "@/lib/uploads/queue";
import { getUploadAdapter } from "@/lib/uploads/adapter";
import { usePipelineProgress } from "@/state/pipelineProgress";

type UploadedFileInfo = { key: string; name: string };

const MAX_IMAGES_PER_SESSION = 200;
const PART_SIZE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "avif",
]);

function isAcceptedImage(file: File): boolean {
  if (file.type && file.type.toLowerCase().startsWith("image/")) return true;
  const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
  return ACCEPTED_IMAGE_EXTENSIONS.has(ext);
}

const Index = () => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadStartedRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [ignoredNonImageCount, setIgnoredNonImageCount] = useState(0);
  const [ignoredOverLimitCount, setIgnoredOverLimitCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const {
    startUploadSession,
    setUploadPrepared,
    updateUploadProgress,
    markUploadComplete,
    startProcessingTracking,
    setPipelineError,
  } = usePipelineProgress();

  const handleClear = useCallback(() => {
    setFiles([]);
    setError(null);
    setIgnoredNonImageCount(0);
    setIgnoredOverLimitCount(0);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const incomingFiles = Array.from(incoming);
    if (incomingFiles.length === 0) return;

    let nonImageIgnored = 0;
    const acceptedIncoming: File[] = [];

    incomingFiles.forEach((file) => {
      if (isAcceptedImage(file)) acceptedIncoming.push(file);
      else nonImageIgnored += 1;
    });

    setFiles((prev) => {
      const combined = prev.concat(acceptedIncoming);
      if (combined.length <= MAX_IMAGES_PER_SESSION) return combined;

      const over = combined.length - MAX_IMAGES_PER_SESSION;
      setIgnoredOverLimitCount((prevOverLimit) => prevOverLimit + over);
      setError(
        `You can upload up to ${MAX_IMAGES_PER_SESSION} images per session. ` +
          `Kept the first ${MAX_IMAGES_PER_SESSION} and ignored ${over} extra image${over === 1 ? "" : "s"}.`,
      );
      return combined.slice(0, MAX_IMAGES_PER_SESSION);
    });

    if (nonImageIgnored > 0) {
      setIgnoredNonImageCount((prevIgnored) => prevIgnored + nonImageIgnored);
    }
  }, []);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  }, [addFiles]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleUpload = useCallback(() => {
    if (files.length === 0 || uploadStartedRef.current) return;
    uploadStartedRef.current = true;
    setError(null);

    const selectedFiles = files.slice(0, MAX_IMAGES_PER_SESSION);
    const totalFiles = selectedFiles.length;
    const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);

    startUploadSession({ totalFiles, totalBytes });
    navigate("/home");

    void (async () => {
      try {
        const adapter = await getUploadAdapter();
        const { albumId } = await adapter.createAlbum();
        setUploadPrepared(albumId);

        sessionStorage.setItem(
          "lastUpload",
          JSON.stringify({
            albumId,
            count: totalFiles,
            keys: [],
            files: [],
          }),
        );

        let manifests;
        try {
          manifests = await createManifestBatch(selectedFiles);
        } catch {
          manifests = selectedFiles.map((f: File) => ({
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
        const manifestByServerId = new Map<string, any>();
        enriched.forEach((m: any) => manifestByServerId.set(m.server_file_id, m));

        const completedFiles: UploadedFileInfo[] = [];
        const completedIds = new Set<string>();
        const uploadedPartsById = new Map<string, Set<number>>();
        let uploadedBytes = 0;
        let uploadedFiles = 0;

        updateUploadProgress({
          uploadedBytes,
          totalBytes,
          uploadedFiles,
          totalFiles,
        });

        const queue = createUploadQueue(adapter, {
          concurrency: 4,
          partSizeBytes: PART_SIZE_BYTES,
          onEvent: (e) => {
            if (e?.type === "part:put:ok" && e?.id && Number.isFinite(Number(e?.partNumber))) {
              const manifest = manifestByServerId.get(e.id);
              if (manifest) {
                const set = uploadedPartsById.get(e.id) || new Set<number>();
                const partNumber = Number(e.partNumber);
                if (!set.has(partNumber)) {
                  set.add(partNumber);
                  uploadedPartsById.set(e.id, set);
                  const bytes = Number(manifest.bytes || 0);
                  const start = (partNumber - 1) * PART_SIZE_BYTES;
                  const partBytes = Math.max(0, Math.min(PART_SIZE_BYTES, bytes - start));
                  uploadedBytes += partBytes;
                  updateUploadProgress({
                    uploadedBytes: Math.min(uploadedBytes, totalBytes),
                    totalBytes,
                    uploadedFiles,
                    totalFiles,
                  });
                }
              }
            }

            if (e?.type === "complete:ok" && e?.id && e?.key) {
              if (!completedIds.has(e.id)) {
                completedIds.add(e.id);
                uploadedFiles += 1;
              }
              const manifest = manifestByServerId.get(e.id);
              const name = manifest?.name || manifest?.__file?.name || e.key.split("/").pop() || "photo";
              if (!completedFiles.some((f) => f.key === e.key)) {
                completedFiles.push({ key: e.key, name });
              }
              updateUploadProgress({
                uploadedBytes: Math.min(uploadedBytes, totalBytes),
                totalBytes,
                uploadedFiles,
                totalFiles,
              });
            }
          },
        });

        await queue.uploadAll(enriched as any);

        updateUploadProgress({
          uploadedBytes: totalBytes,
          totalBytes,
          uploadedFiles: totalFiles,
          totalFiles,
        });

        sessionStorage.setItem(
          "lastUpload",
          JSON.stringify({
            albumId,
            count: manifests.length,
            keys: completedFiles.map((file) => file.key),
            files: completedFiles,
          }),
        );

        markUploadComplete(albumId);

        const base = import.meta.env.VITE_API_BASE_URL || "";
        if (base && completedFiles.length > 0) {
          const startRes = await fetch(`${base}/processing/post-upload/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ albumId, files: completedFiles }),
          });
          if (!startRes.ok) {
            const text = await startRes.text().catch(() => "");
            throw new Error(text || "Failed to start post-upload processing.");
          }
          startProcessingTracking(albumId);
        } else {
          setPipelineError("Upload completed, but processing could not start (missing API base URL or uploaded file keys).");
        }
      } catch (err: any) {
        setPipelineError(err?.message || "Background upload failed.");
        uploadStartedRef.current = false;
      }
    })();
  }, [
    files,
    markUploadComplete,
    navigate,
    setPipelineError,
    setUploadPrepared,
    startProcessingTracking,
    startUploadSession,
    updateUploadProgress,
  ]);

  return (
    <div data-testid="prehome-upload-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        <div className="bg-card/90 rounded-2xl shadow-vintage p-8 md:p-10 border border-border">
          <h1 className="text-4xl md:text-5xl font-semibold text-center mb-3" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
            Drop your images
          </h1>
          <p className="text-center text-[#4F6420]/80 mb-6">
            Add up to {MAX_IMAGES_PER_SESSION} photos (JPEG, PNG, WEBP, HEIC/HEIF and other common image types).
          </p>

          <div
            data-testid="prehome-upload-dropzone"
            onDragEnter={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDragOver(false);
              }
            }}
            onDrop={onDrop}
            className={[
              "relative z-0 rounded-2xl p-8 md:p-10 border-2 border-dashed text-center transition-colors",
              isDragOver ? "border-[#6B8E23] bg-[#E8EBD1]" : "border-[#A7B580] bg-[#F9F9F5]",
            ].join(" ")}
          >
            <p className="text-lg font-medium text-[#4F6420] mb-4">
              Drag and drop your files here
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.bmp,.tif,.tiff,.avif"
              multiple
              className="hidden"
              onChange={onPick}
            />
            <Button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="relative z-10 bg-[#6B8E23] text-white hover:bg-[#5b7a1d]"
            >
              Open file picker
            </Button>
          </div>

          <div className="mt-5 space-y-2 text-[#4F6420]">
            <p data-testid="selected-count" className="font-medium">
              Selected images: {files.length}/{MAX_IMAGES_PER_SESSION}
            </p>
            {ignoredNonImageCount > 0 ? (
              <p className="text-sm text-[#4F6420]/80">
                Ignored non-image files: {ignoredNonImageCount}
              </p>
            ) : null}
            {ignoredOverLimitCount > 0 ? (
              <p className="text-sm text-[#4F6420]/80">
                Ignored due to {MAX_IMAGES_PER_SESSION}-image limit: {ignoredOverLimitCount}
              </p>
            ) : null}
            {error ? (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">{error}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleUpload} disabled={files.length === 0} className="bg-[#6B8E23] text-white hover:bg-[#5b7a1d]">
              Upload {files.length > 0 ? `${files.length} image${files.length === 1 ? "" : "s"}` : "images"}
            </Button>
            <Button type="button" variant="outline" onClick={handleClear} disabled={files.length === 0 && ignoredNonImageCount === 0 && ignoredOverLimitCount === 0}>
              Clear
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
