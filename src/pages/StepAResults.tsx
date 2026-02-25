import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type PostUploadStatus = {
  albumId: string;
  status: string;
  progress: number;
  error?: string | null;
  error_log_excerpt?: string | null;
  counts?: {
    uploaded_count?: number;
    staged_count?: number;
    step_a_groups_count?: number;
    step_a_reduced_pool_count?: number;
  };
};

type StepAListResponse = {
  albumId: string;
  items: string[];
};

const POLL_MS = 2000;

export default function StepAResults() {
  const navigate = useNavigate();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [status, setStatus] = useState<PostUploadStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<string[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem("lastUpload");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const id = typeof parsed?.albumId === "string" ? parsed.albumId : null;
      if (id) setAlbumId(id);
    } catch {
      setLoadError("Could not read current upload session.");
    }
  }, []);

  useEffect(() => {
    if (!albumId || !base) return;
    let isActive = true;
    let intervalId: number | null = null;

    const poll = async () => {
      try {
        const url = `${base}/processing/post-upload/status?albumId=${encodeURIComponent(albumId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || "Failed to fetch Step A status.");
        }
        const data = (await res.json()) as PostUploadStatus;
        if (!isActive) return;
        setStatus(data);
        setLoadError(null);
        if (data.status === "done_a" || data.status === "error") {
          if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err: any) {
        if (!isActive) return;
        setLoadError(err?.message || "Failed to load Step A status.");
      }
    };

    poll();
    intervalId = window.setInterval(poll, POLL_MS);
    return () => {
      isActive = false;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [albumId, base]);

  useEffect(() => {
    if (!albumId || !base || status?.status !== "done_a") return;
    let isActive = true;
    const loadAssets = async () => {
      try {
        const url = `${base}/processing/post-upload/step-a/list?albumId=${encodeURIComponent(albumId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || "Failed to list Step A assets.");
        }
        const data = (await res.json()) as StepAListResponse;
        if (!isActive) return;
        setAssets(Array.isArray(data.items) ? data.items : []);
      } catch (err: any) {
        if (!isActive) return;
        setLoadError(err?.message || "Failed to load Step A assets.");
      }
    };
    loadAssets();
    return () => {
      isActive = false;
    };
  }, [albumId, base, status?.status]);

  const statusLabel = useMemo(() => {
    const raw = status?.status;
    if (!raw) return "waiting";
    return raw.replaceAll("_", " ");
  }, [status?.status]);

  return (
    <div data-testid="step-a-results-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
      <div className="max-w-5xl w-full">
        <div className="bg-card/90 rounded-2xl shadow-vintage p-8 md:p-10 border border-border">
          <h1 className="text-4xl md:text-5xl font-semibold text-center mb-3" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
            Step A Results
          </h1>
          <p className="text-center text-[#4F6420]/80 mb-6">
            Album: {albumId || "Not found"}
          </p>

          {!albumId ? (
            <p className="text-center text-red-700 mb-4">
              No active upload session found.
            </p>
          ) : null}

          <div className="mb-6 rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">
            <p className="font-medium">
              Status: {statusLabel}
              {status?.progress != null ? ` - ${Math.round(status.progress * 100)}%` : ""}
            </p>
            {status?.status !== "done_a" && status?.status !== "error" ? (
              <p className="text-sm text-[#4F6420]/80 mt-1">Processing Step A in the background...</p>
            ) : null}
            {loadError ? (
              <p className="text-sm text-red-700 mt-2">{loadError}</p>
            ) : null}
            {status?.status === "error" ? (
              <div className="mt-2 space-y-1 text-sm text-red-700">
                <p>{status.error || "Step A failed."}</p>
                {status.error_log_excerpt ? (
                  <pre className="whitespace-pre-wrap text-xs bg-red-50 border border-red-200 rounded p-2 overflow-auto max-h-48">{status.error_log_excerpt}</pre>
                ) : null}
              </div>
            ) : null}
          </div>

          {status?.status === "done_a" ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
                  <p className="text-[#4F6420]/70">Uploaded</p>
                  <p className="font-semibold text-[#4F6420]">{status.counts?.uploaded_count ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
                  <p className="text-[#4F6420]/70">Staged</p>
                  <p className="font-semibold text-[#4F6420]">{status.counts?.staged_count ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
                  <p className="text-[#4F6420]/70">Groups</p>
                  <p className="font-semibold text-[#4F6420]">{status.counts?.step_a_groups_count ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
                  <p className="text-[#4F6420]/70">Reduced Pool</p>
                  <p className="font-semibold text-[#4F6420]">{status.counts?.step_a_reduced_pool_count ?? 0}</p>
                </div>
              </div>

              {assets.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {assets.map((rel) => {
                    const src = `${base}/processing/post-upload/asset?albumId=${encodeURIComponent(albumId || "")}&rel=${encodeURIComponent(rel)}`;
                    return (
                      <div key={rel} className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-2">
                        <img src={src} alt={rel.split("/").pop() || "Step A image"} className="w-full h-40 object-cover rounded-md" loading="lazy" />
                        <p className="text-xs text-[#4F6420]/80 mt-2 truncate" title={rel}>{rel.split("/").pop()}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[#4F6420]/80">No reduced_pool files listed yet.</p>
              )}
            </div>
          ) : null}

          <div className="mt-8">
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
