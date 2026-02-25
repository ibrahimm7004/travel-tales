import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import OliveLoader from "@/components/OliveLoader";
import { Button } from "@/components/ui/button";
import { createManifestBatch } from "@/lib/uploads/manifest";
import { createUploadQueue } from "@/lib/uploads/queue";
import { getUploadAdapter } from "@/lib/uploads/adapter";
import { isUploadDebugEnabled } from "@/lib/debug";

type UploadedFileInfo = { key: string; name: string };

const MAX_IMAGES_PER_SESSION = 200;
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
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [ignoredNonImageCount, setIgnoredNonImageCount] = useState(0);
  const [ignoredOverLimitCount, setIgnoredOverLimitCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{
    mode: string;
    apiBaseUrl: string;
    firstEndpoint: string;
    likelyCause: string;
  } | null>(null);
  const debugVerbose = isUploadDebugEnabled() || (import.meta.env.VITE_UPLOAD_DEBUG || "") === "1";

  const handleClear = useCallback(() => {
    setFiles([]);
    setError(null);
    setErrorDetails(null);
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
      setErrorDetails(null);
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

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || isUploading) return;

    setIsUploading(true);
    setError(null);
    setErrorDetails(null);

    try {
      const resolvedMode = (import.meta.env.VITE_UPLOAD_MODE || "mock").toLowerCase();
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";
      const firstEndpoint =
        resolvedMode === "s3" ? `${apiBaseUrl}/albums` : "mock://local-adapter (no HTTP endpoint)";
      const adapter = await getUploadAdapter();
      const { albumId } = await adapter.createAlbum();
      const fileArray = Array.from(files);

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
      const manifestByServerId = new Map<string, any>();
      enriched.forEach((m: any) => manifestByServerId.set(m.server_file_id, m));
      const completedFilesRef = { current: [] as UploadedFileInfo[] };
      const queue = createUploadQueue(adapter, {
        concurrency: 4,
        onEvent: (e) => {
          if (e?.type === "complete:ok" && e?.key) {
            const manifest = manifestByServerId.get(e.id);
            const name = manifest?.name || manifest?.__file?.name || e.key.split("/").pop() || "photo";
            const entry = { key: e.key, name } as UploadedFileInfo;
            completedFilesRef.current = completedFilesRef.current.concat(entry);
          }
        },
      });

      await queue.uploadAll(enriched as any);

      sessionStorage.setItem(
        "lastUpload",
        JSON.stringify({
          albumId,
          count: manifests.length,
          keys: completedFilesRef.current.map((file) => file.key),
          files: completedFilesRef.current,
        }),
      );

      navigate("/home");
    } catch (err: any) {
      setError(err?.message || "Upload failed. Please try again.");
      const resolvedMode = (import.meta.env.VITE_UPLOAD_MODE || "mock").toLowerCase();
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";
      const firstEndpoint =
        resolvedMode === "s3" ? `${apiBaseUrl}/albums` : "mock://local-adapter (no HTTP endpoint)";
      const pageProtocol = typeof window !== "undefined" ? window.location.protocol : "";
      let likelyCause = "";
      if (resolvedMode === "s3" && !apiBaseUrl) {
        likelyCause = "VITE_API_BASE_URL is empty while VITE_UPLOAD_MODE is s3.";
      } else if (resolvedMode === "s3" && pageProtocol === "https:" && apiBaseUrl.startsWith("http://")) {
        likelyCause = "Mixed content: app is HTTPS but API base URL is HTTP.";
      } else if ((err?.message || "").toLowerCase().includes("failed to fetch")) {
        likelyCause = "Network/CORS/server issue when calling the first S3 endpoint.";
      } else {
        likelyCause = "See error message and first endpoint for exact failing target.";
      }
      setErrorDetails({
        mode: resolvedMode,
        apiBaseUrl,
        firstEndpoint,
        likelyCause,
      });
    } finally {
      setIsUploading(false);
    }
  }, [files, isUploading, navigate]);

  if (isUploading) {
    return (
      <div data-testid="prehome-upload-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
        <div className="max-w-3xl w-full">
          <div className="bg-card/90 rounded-2xl shadow-vintage p-10 border border-border text-center">
            <h2 className="text-2xl font-semibold mb-4" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Uploading your images...</h2>
            <OliveLoader testId="prehome-upload-loader" subline="Uploading your files..." />
          </div>
        </div>
      </div>
    );
  }

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
                <p className="font-medium">Upload error: {error}</p>
                {debugVerbose && errorDetails ? (
                  <div className="mt-2 space-y-1 text-xs break-all">
                    <p><span className="font-semibold">Resolved mode:</span> {errorDetails.mode}</p>
                    <p><span className="font-semibold">API base URL:</span> {errorDetails.apiBaseUrl || "(empty)"}</p>
                    <p><span className="font-semibold">First endpoint attempted:</span> {errorDetails.firstEndpoint}</p>
                    <p><span className="font-semibold">Likely cause:</span> {errorDetails.likelyCause}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleUpload} disabled={files.length === 0 || isUploading} className="bg-[#6B8E23] text-white hover:bg-[#5b7a1d]">
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
