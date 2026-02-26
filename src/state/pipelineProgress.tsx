import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type PipelineUiState = {
  visible: boolean;
  mode: "idle" | "uploading" | "processing" | "error";
  progress: number;
  label: string;
  detail: string;
  albumId: string | null;
};

type UploadStartInput = {
  totalFiles: number;
  totalBytes: number;
};

type UploadProgressInput = {
  uploadedBytes: number;
  totalBytes: number;
  uploadedFiles: number;
  totalFiles: number;
};

type PostUploadStatus = {
  albumId: string;
  status: string;
  progress: number;
  error?: string | null;
  counts?: Record<string, number>;
};

const PROCESSING_WEIGHTS = {
  staging: 0.10,
  dedupe: 0.15,
  dino: 0.30,
  mood: 0.05,
  clip: 0.40,
} as const;

const PROCESSING_BASES = {
  staging: 0,
  dedupe: PROCESSING_WEIGHTS.staging,
  dino: PROCESSING_WEIGHTS.staging + PROCESSING_WEIGHTS.dedupe,
  mood: PROCESSING_WEIGHTS.staging + PROCESSING_WEIGHTS.dedupe + PROCESSING_WEIGHTS.dino,
  clip: PROCESSING_WEIGHTS.staging + PROCESSING_WEIGHTS.dedupe + PROCESSING_WEIGHTS.dino + PROCESSING_WEIGHTS.mood,
} as const;

type PipelineProgressContextValue = {
  state: PipelineUiState;
  startUploadSession: (input: UploadStartInput) => void;
  setUploadPrepared: (albumId: string) => void;
  updateUploadProgress: (input: UploadProgressInput) => void;
  markUploadComplete: (albumId: string) => void;
  startProcessingTracking: (albumId: string) => void;
  setPipelineError: (message: string) => void;
  clear: () => void;
};

const INITIAL_STATE: PipelineUiState = {
  visible: false,
  mode: "idle",
  progress: 0,
  label: "",
  detail: "",
  albumId: null,
};

const PipelineProgressContext = createContext<PipelineProgressContextValue | null>(null);

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function mapStatusToUi(status: PostUploadStatus): { label: string; detail: string } {
  const counts = status.counts || {};
  const c = (name: string) => Number(counts[name] || 0);
  switch (status.status) {
    case "queued":
      return { label: "Queued for processing", detail: "Waiting to start post-upload pipeline." };
    case "staging_inputs":
      return { label: "Staging uploaded images", detail: `Uploaded: ${c("uploaded_count")} | Staged: ${c("staged_count")}` };
    case "running_a":
      return { label: "Step A: dedupe + representative selection", detail: `Uploaded: ${c("uploaded_count")} | Staged: ${c("staged_count")}` };
    case "done_a":
      return { label: "Step A complete", detail: `Groups: ${c("step_a_groups_count")} | Reduced pool: ${c("step_a_reduced_pool_count")}` };
    case "running_b_dino":
      return { label: "Step B: DINO + KMeans clustering", detail: "Building visual clusters (pre-CLIP)." };
    case "waiting_user_moods":
      return { label: "Waiting for mood selection", detail: "Select moods to continue CLIP reranking." };
    case "running_b_clip":
      return { label: "Step B: CLIP rerank + naming", detail: "Applying mood preferences and naming clusters." };
    case "done_b":
      return { label: "Processing complete", detail: `Clusters: ${c("step_b_cluster_count")} | Ranked images: ${c("step_b_image_count")}` };
    case "error":
      return { label: "Processing error", detail: status.error || "Unknown pipeline error." };
    default:
      return { label: "Processing", detail: status.status || "Running..." };
  }
}

function estimateFromElapsed(elapsedMs: number, expectedMs: number, cap = 0.985): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0.02;
  const raw = elapsedMs / Math.max(1, expectedMs);
  return Math.min(cap, Math.max(0.02, raw));
}

function computeProcessingProgress(status: PostUploadStatus, elapsedMs: number): number {
  const counts = status.counts || {};
  const c = (name: string) => Number(counts[name] || 0);
  const uploaded = Math.max(1, c("uploaded_count"));
  const staged = Math.max(1, c("staged_count") || c("uploaded_count"));
  const reduced = Math.max(1, c("step_a_reduced_pool_count") || c("staged_count") || c("uploaded_count"));

  switch (status.status) {
    case "queued":
      return 0.01;
    case "staging_inputs": {
      const stagedRatio = c("staged_count") > 0 && c("uploaded_count") > 0
        ? clamp01(c("staged_count") / Math.max(1, c("uploaded_count")))
        : estimateFromElapsed(elapsedMs, 1200 + uploaded * 120);
      return PROCESSING_BASES.staging + PROCESSING_WEIGHTS.staging * stagedRatio;
    }
    case "running_a": {
      const stepRatio = estimateFromElapsed(elapsedMs, 5200 + staged * 340);
      return PROCESSING_BASES.dedupe + PROCESSING_WEIGHTS.dedupe * stepRatio;
    }
    case "done_a":
      return PROCESSING_BASES.dino;
    case "running_b_dino": {
      const stepRatio = estimateFromElapsed(elapsedMs, 9200 + reduced * 680);
      return PROCESSING_BASES.dino + PROCESSING_WEIGHTS.dino * stepRatio;
    }
    case "waiting_user_moods": {
      const stepRatio = estimateFromElapsed(elapsedMs, 1200, 1.0);
      return PROCESSING_BASES.mood + PROCESSING_WEIGHTS.mood * stepRatio;
    }
    case "running_b_clip": {
      const stepRatio = estimateFromElapsed(elapsedMs, 12200 + reduced * 920);
      return PROCESSING_BASES.clip + PROCESSING_WEIGHTS.clip * stepRatio;
    }
    case "done_b":
      return 1;
    case "error":
      return clamp01(PROCESSING_BASES.clip);
    default:
      return 0.01;
  }
}

export function PipelineProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PipelineUiState>(INITIAL_STATE);
  const [pollAlbumId, setPollAlbumId] = useState<string | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const statusRef = useRef<string>("");
  const statusStartedAtRef = useRef<number>(Date.now());
  const lastProcessingStatusRef = useRef<PostUploadStatus | null>(null);
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";

  const clear = useMemo(() => () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    lastProcessingStatusRef.current = null;
    setState(INITIAL_STATE);
    setPollAlbumId(null);
  }, []);

  const ctx: PipelineProgressContextValue = useMemo(
    () => ({
      state,
      startUploadSession: ({ totalFiles, totalBytes }) => {
        setState({
          visible: true,
          mode: "uploading",
          progress: 0,
          label: "Preparing upload",
          detail: `${totalFiles} image${totalFiles === 1 ? "" : "s"} | ${formatBytes(totalBytes)}`,
          albumId: null,
        });
      },
      setUploadPrepared: (albumId: string) => {
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: "uploading",
          albumId,
          label: "Upload session created",
          detail: "Uploading images in the background.",
        }));
      },
      updateUploadProgress: ({ uploadedBytes, totalBytes, uploadedFiles, totalFiles }) => {
        const progress = totalBytes > 0 ? clamp01(uploadedBytes / totalBytes) : clamp01(uploadedFiles / Math.max(1, totalFiles));
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: "uploading",
          progress,
          label: "Uploading images",
          detail: `${uploadedFiles}/${totalFiles} images | ${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}`,
        }));
      },
      markUploadComplete: (albumId: string) => {
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: "uploading",
          progress: 1,
          albumId,
          label: "Upload complete",
          detail: "Starting post-upload processing...",
        }));
      },
      startProcessingTracking: (albumId: string) => {
        statusRef.current = "";
        statusStartedAtRef.current = Date.now();
        lastProcessingStatusRef.current = null;
        setPollAlbumId(albumId);
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: "processing",
          albumId,
          label: "Queued for processing",
          detail: "Waiting for backend pipeline status...",
          progress: 0,
        }));
      },
      setPipelineError: (message: string) => {
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: "error",
          label: "Pipeline error",
          detail: message,
        }));
        setPollAlbumId(null);
      },
      clear,
    }),
    [clear, state],
  );

  useEffect(() => {
    if (!pollAlbumId || !apiBase) return;
    let active = true;
    let intervalId: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/processing/post-upload/status?albumId=${encodeURIComponent(pollAlbumId)}`);
        if (res.status === 404) return;
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || "Failed to fetch processing status.");
        }
        const data = (await res.json()) as PostUploadStatus;
        if (!active) return;
        if (data.status !== statusRef.current) {
          statusRef.current = data.status;
          statusStartedAtRef.current = Date.now();
        }
        lastProcessingStatusRef.current = data;
        const elapsedMs = Date.now() - statusStartedAtRef.current;
        const weighted = computeProcessingProgress(data, elapsedMs);
        const mapped = mapStatusToUi(data);
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: data.status === "error" ? "error" : "processing",
          albumId: data.albumId || pollAlbumId,
          progress: Math.max(prev.progress, clamp01(weighted)),
          label: mapped.label,
          detail: mapped.detail,
        }));
        if (data.status === "done_b") {
          setPollAlbumId(null);
          if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
          hideTimerRef.current = window.setTimeout(() => {
            clear();
          }, 1400);
        } else if (data.status === "error") {
          setPollAlbumId(null);
        }
      } catch (err: any) {
        if (!active) return;
        setState((prev) => ({
          ...prev,
          visible: true,
          mode: "error",
          label: "Pipeline error",
          detail: err?.message || "Processing status check failed.",
        }));
        setPollAlbumId(null);
      }
    };

    poll();
    intervalId = window.setInterval(poll, 2000);
    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [apiBase, clear, pollAlbumId]);

  useEffect(() => {
    if (!pollAlbumId) return;
    const tickId = window.setInterval(() => {
      const status = lastProcessingStatusRef.current;
      if (!status) return;
      if (status.status === "done_b" || status.status === "error") return;
      const elapsedMs = Date.now() - statusStartedAtRef.current;
      const weighted = computeProcessingProgress(status, elapsedMs);
      setState((prev) => {
        if (prev.mode !== "processing") return prev;
        const next = Math.max(prev.progress, clamp01(weighted));
        if (next <= prev.progress + 0.0005) return prev;
        return { ...prev, progress: next };
      });
    }, 200);
    return () => window.clearInterval(tickId);
  }, [pollAlbumId]);

  return <PipelineProgressContext.Provider value={ctx}>{children}</PipelineProgressContext.Provider>;
}

export function usePipelineProgress() {
  const ctx = useContext(PipelineProgressContext);
  if (!ctx) throw new Error("usePipelineProgress must be used within PipelineProgressProvider");
  return ctx;
}
