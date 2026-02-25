import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import S3Panel from "@/components/dev/S3Panel";

type ProcessingFile = { key: string; name: string };
type ProcessingStatus = {
  status: "pending" | "processing" | "complete" | "error";
  runId: string;
  albumId: string;
  progress?: number;
  s3Prefix?: string;
  survivors?: string[];
  error?: string;
};
type StartResponse = { runId: string };

const POLL_INTERVAL_MS = 2000;

export default function ProcessingPage() {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [albumPrefix, setAlbumPrefix] = useState<string | undefined>(undefined);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const autoStartRef = useRef(false);
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const debugProcessing = import.meta.env.VITE_DEBUG_PROCESSING === "1";

  useEffect(() => {
    const raw = sessionStorage.getItem("lastUpload");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      setCount(Number(parsed?.count || 0));
      const parsedAlbumId = typeof parsed?.albumId === "string" ? parsed.albumId : null;
      setAlbumId(parsedAlbumId);
      const rawFiles = Array.isArray(parsed?.files) ? parsed.files : Array.isArray(parsed?.keys)
        ? (parsed.keys as string[]).map((key: string) => ({ key, name: key.split("/").pop() || key }))
        : [];
      const normalized = rawFiles
        .map((entry: any, idx: number) => {
          if (typeof entry === "string") {
            return { key: entry, name: entry.split("/").pop() || `photo_${idx + 1}` };
          }
          if (entry && typeof entry.key === "string") {
            return {
              key: entry.key,
              name: typeof entry.name === "string" && entry.name.length > 0
                ? entry.name
                : entry.key.split("/").pop() || `photo_${idx + 1}`,
            };
          }
          return null;
        })
        .filter((item): item is ProcessingFile => Boolean(item));
      setFiles(normalized);
      const derivedKeys = normalized.map((file) => file.key);
      setKeys(derivedKeys);
      if (derivedKeys.length) {
        const prefix = derivedKeys[0].split("/").slice(0, -1).join("/") + "/";
        setAlbumPrefix(prefix);
      }
    } catch {
      setStartError("Unable to read upload session data.");
    }
  }, []);

  useEffect(() => {
    if (!albumId || runId) return;
    const raw = sessionStorage.getItem("processingRun");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.albumId === albumId && typeof parsed?.runId === "string") {
        setRunId(parsed.runId);
      }
    } catch {
      // ignore malformed cached runs
    }
  }, [albumId, runId]);

  const startProcessing = useCallback(async () => {
    if (!albumId || files.length === 0) return;
    if (!base) {
      setStartError("Processing API base URL is not configured.");
      return;
    }
    setIsStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`${base}/processing/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumId, files }),
      });
      if (res.status === 501) {
        const body = await res.json().catch(() => ({}));
        setStartError(body?.detail || "Image pipeline is disabled.");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Failed to start processing.");
      }
      const data: StartResponse = await res.json();
      setRunId(data.runId);
      sessionStorage.setItem("processingRun", JSON.stringify({ albumId, runId: data.runId, startedAt: Date.now() }));
      setStatus({ status: "pending", runId: data.runId, albumId });
      if (debugProcessing) console.debug("[PROCESSING][START]", data);
    } catch (err: any) {
      if (debugProcessing) console.debug("[PROCESSING][START][ERROR]", err);
      setStartError(err?.message || "Processing request failed.");
    } finally {
      setIsStarting(false);
    }
  }, [albumId, files, base, debugProcessing]);

  useEffect(() => {
    if (!albumId || files.length === 0) return;
    if (runId || isStarting || autoStartRef.current) return;
    autoStartRef.current = true;
    startProcessing();
  }, [albumId, files, runId, isStarting, startProcessing]);

  useEffect(() => {
    if (!runId || !albumId || !base) return;
    let isActive = true;
    let intervalId: number | null = null;

    const poll = async () => {
      if (!isActive) return;
      try {
        const url = new URL(`${base}/processing/status`);
        url.searchParams.set("albumId", albumId);
        url.searchParams.set("runId", runId);
        const res = await fetch(url.toString());
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || "Status request failed.");
        }
        const data: ProcessingStatus = await res.json();
        if (debugProcessing) console.debug("[PROCESSING][STATUS]", data);
        if (!isActive) return;
        setStatus(data);
        setStartError(null);
        if (data.status === "complete" || data.status === "error") {
          if (intervalId) {
            window.clearInterval(intervalId);
            pollRef.current = null;
            intervalId = null;
          }
          sessionStorage.removeItem("processingRun");
        }
      } catch (err: any) {
        if (!isActive) return;
        setStartError(err?.message || "Unable to fetch processing status.");
      }
    };

    poll();
    intervalId = window.setInterval(poll, POLL_INTERVAL_MS);
    pollRef.current = intervalId;

    return () => {
      isActive = false;
      if (intervalId) {
        window.clearInterval(intervalId);
        pollRef.current = null;
      }
    };
  }, [runId, albumId, base, debugProcessing]);

  const survivorCount = status?.survivors?.length ?? 0;
  const statusLabel = status?.status
    ? status.status === "complete"
      ? "Complete"
      : status.status === "processing"
        ? "Processing"
        : status.status === "error"
          ? "Error"
          : "Pending"
    : runId
      ? "Pending"
      : isStarting
        ? "Starting"
        : "Waiting";
  const progressPercent = status?.progress != null ? Math.round(status.progress * 100) : null;
  const hasUploadData = Boolean(albumId && files.length);
  const canRetry = Boolean(albumId && files.length && !isStarting);

  return (
    <div data-testid="processing-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        <div className="bg-card/90 rounded-2xl shadow-vintage p-10 border border-border text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 border border-[#6B8E23] bg-[#F9F9F5] text-[#4F6420] text-sm mb-6" data-testid="processing-count">
            Uploaded {count} photos
          </div>
          <h2 className="text-2xl font-semibold mb-2" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
            Processing your images
          </h2>
          {!hasUploadData && (
            <p className="text-[#4F6420]/80 mb-6">
              We couldn&apos;t find recent uploads. Please upload photos again to start processing.
            </p>
          )}
          {hasUploadData && (
            <div className="space-y-4 mb-6">
              <p className="text-[#4F6420]/80">
                Status: <span className="font-semibold text-[#4F6420]">{statusLabel}</span>
                {progressPercent !== null ? ` · ${progressPercent}%` : null}
                {runId ? ` · Run ${runId.slice(0, 8)}` : null}
              </p>
              {status?.status === "complete" && (
                <div className="space-y-2 text-[#4F6420]/90">
                  <p>Survivors kept: <span className="font-semibold">{survivorCount}</span></p>
                  {status.s3Prefix ? (
                    <p>
                      Artifacts saved under:&nbsp;
                      <code className="px-2 py-1 rounded bg-[#F3F5E2] text-sm text-[#4F6420]">{status.s3Prefix}</code>
                    </p>
                  ) : null}
                </div>
              )}
              {status?.status === "error" && (
                <p className="text-red-700">Pipeline error: {status.error || "Unknown error"}</p>
              )}
              {startError && (
                <p className="text-red-700">{startError}</p>
              )}
              {!runId && hasUploadData && (
                <button
                  onClick={startProcessing}
                  disabled={isStarting}
                  className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1] disabled:opacity-50"
                >
                  {isStarting ? "Starting…" : "Start processing"}
                </button>
              )}
              {status?.status === "error" && canRetry && (
                <button
                  onClick={() => {
                    setRunId(null);
                    sessionStorage.removeItem("processingRun");
                    autoStartRef.current = true;
                    startProcessing();
                  }}
                  className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]"
                >
                  Retry processing
                </button>
              )}
            </div>
          )}
          <button onClick={() => navigate("/home")} className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]">
            Back to Home
          </button>
        </div>
        {/* Hidden S3 debug panel */}
        <div className="mt-4">
          <S3Panel albumPrefix={albumPrefix} sampleKeys={keys.slice(-5)} />
        </div>
      </div>
    </div>
  );
}