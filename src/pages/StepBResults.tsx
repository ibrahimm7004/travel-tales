import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DEMO_RESULTS } from "@/pages/results/demoConfig";
import {
  buildDemoAssetUrl,
  probeAssetPaths,
  resolveAlbumIdFromQueryOrSession,
  withAlbumId,
  type PostUploadStatus,
} from "@/pages/results/demoHelpers";
import { ResultsLayout } from "@/pages/results/ResultsLayout";

const DEMO_PROBE_PATHS = [
  "step_a/dedupe.jsonl",
  "step_a/step_a_manifest.jsonl",
  "step_b/step_b_kmeans_clusters.jsonl",
  "step_b/step_b_clusters.jsonl",
];

type ClusterRow = {
  cluster_id: number;
  size: number;
  cluster_name: string;
  mood_label?: string;
  cluster_desc_topk?: { label: string; score: number }[];
};

type ImageRow = {
  path: string;
  cluster_id: number;
  rank_in_cluster: number;
  pref_score: number;
  styles_topk?: { tag: string; score: number }[];
};

const POLL_MS = 2000;

export default function StepBResults() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [status, setStatus] = useState<PostUploadStatus | null>(null);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probed, setProbed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const id = resolveAlbumIdFromQueryOrSession(location.search);
    if (id) {
      setAlbumId(id);
    } else {
      setLoadError("Could not read current upload session.");
    }
  }, [location.search]);

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
          throw new Error(text || "Failed to fetch Step B status.");
        }
        const data = (await res.json()) as PostUploadStatus;
        if (!isActive) return;
        setStatus(data);
        setLoadError(null);
        if (data.status === "done_b" || data.status === "error") {
          if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err: any) {
        if (!isActive) return;
        setLoadError(err?.message || "Failed to fetch status.");
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
    if (!albumId || !base || status?.status !== "done_b") return;
    let isActive = true;
    const load = async () => {
      try {
        const [clustersRes, imagesRes] = await Promise.all([
          fetch(`${base}/processing/post-upload/step-b/clusters?albumId=${encodeURIComponent(albumId)}`),
          fetch(`${base}/processing/post-upload/step-b/images?albumId=${encodeURIComponent(albumId)}`),
        ]);
        if (!clustersRes.ok) {
          const text = await clustersRes.text().catch(() => "");
          throw new Error(text || "Failed loading Step B clusters.");
        }
        if (!imagesRes.ok) {
          const text = await imagesRes.text().catch(() => "");
          throw new Error(text || "Failed loading Step B images.");
        }
        const clustersJson = await clustersRes.json();
        const imagesJson = await imagesRes.json();
        if (!isActive) return;
        const clusterItems: ClusterRow[] = Array.isArray(clustersJson?.items) ? clustersJson.items : [];
        const imageItems: ImageRow[] = Array.isArray(imagesJson?.items) ? imagesJson.items : [];
        clusterItems.sort((a, b) => (a.cluster_id ?? 0) - (b.cluster_id ?? 0));
        imageItems.sort((a, b) => {
          const c = (a.cluster_id ?? 0) - (b.cluster_id ?? 0);
          if (c !== 0) return c;
          const r = (a.rank_in_cluster ?? 0) - (b.rank_in_cluster ?? 0);
          if (r !== 0) return r;
          return String(a.path || "").localeCompare(String(b.path || ""));
        });
        setClusters(clusterItems);
        setImages(imageItems);
      } catch (err: any) {
        if (!isActive) return;
        setLoadError(err?.message || "Failed loading Step B results.");
      }
    };
    load();
    return () => {
      isActive = false;
    };
  }, [albumId, base, status?.status]);

  useEffect(() => {
    if (!DEMO_RESULTS || !albumId || !base) return;
    let isActive = true;
    const run = async () => {
      const map = await probeAssetPaths(base, albumId, DEMO_PROBE_PATHS);
      if (!isActive) return;
      setProbed(map);
    };
    run();
    return () => {
      isActive = false;
    };
  }, [albumId, base, status?.status]);

  const imagesByCluster = useMemo(() => {
    const grouped = new Map<number, ImageRow[]>();
    for (const row of images) {
      const key = Number(row.cluster_id || 0);
      const list = grouped.get(key) || [];
      list.push(row);
      grouped.set(key, list);
    }
    return grouped;
  }, [images]);

  const statusLabel = (status?.status || "waiting").replaceAll("_", " ");
  const stepAReady = !!status && ["done_a", "running_b_dino", "waiting_user_moods", "running_b_clip", "done_b"].includes(status.status);
  const dinoReady = (!!status && ["running_b_dino", "waiting_user_moods", "running_b_clip", "done_b"].includes(status.status)) || !!probed["step_b/step_b_kmeans_clusters.jsonl"];
  const clipReady = status?.status === "done_b" || !!probed["step_b/step_b_clusters.jsonl"];

  const demoBtnClass = "inline-flex items-center justify-center px-3 py-2 rounded-lg border border-[#A7B580] bg-white text-[#4F6420] text-sm hover:bg-[#E8EBD1] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <ResultsLayout testId="step-b-results-page" title="Step B Results" albumId={albumId}>
      {DEMO_RESULTS ? (
        <section className="mb-6 flex justify-end">
          <div className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-3 w-full md:w-auto">
            <p className="text-xs font-semibold text-[#4F6420] mb-2">Demo Outputs</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={demoBtnClass}
                disabled={!stepAReady}
                onClick={() => navigate(withAlbumId("/results/step-a", albumId))}
              >
                Step A Outputs
              </button>
              <button
                type="button"
                className={demoBtnClass}
                disabled={!dinoReady}
                onClick={() => navigate(withAlbumId("/results/dino-only", albumId))}
              >
                DINO Clusters (pre-CLIP)
              </button>
              <button
                type="button"
                className={demoBtnClass}
                disabled={!clipReady}
                onClick={() => navigate(withAlbumId("/results/clip-naming", albumId))}
              >
                CLIP Naming Details
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mb-6 rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">
        <p className="font-medium">
          Status: {statusLabel}{status?.progress != null ? ` - ${Math.round(status.progress * 100)}%` : ""}
        </p>
        {status?.status !== "done_b" && status?.status !== "error" ? (
          <p className="text-sm text-[#4F6420]/80 mt-1">
            Processing in background. If status shows waiting user moods, finish onboarding mood step to continue.
          </p>
        ) : null}
        {loadError ? <p className="text-sm text-red-700 mt-2">{loadError}</p> : null}
        {status?.status === "error" ? (
          <div className="mt-2 space-y-1 text-sm text-red-700">
            <p>{status.error || "Step B failed."}</p>
            {status.error_log_excerpt ? (
              <pre className="whitespace-pre-wrap text-xs bg-red-50 border border-red-200 rounded p-2 overflow-auto max-h-48">{status.error_log_excerpt}</pre>
            ) : null}
          </div>
        ) : null}
      </div>

      {status?.status === "done_b" ? (
        <div className="space-y-6">
          {clusters.map((cluster) => {
            const clusterImages = imagesByCluster.get(Number(cluster.cluster_id || 0)) || [];
            const topDescriptors = (cluster.cluster_desc_topk || []).slice(0, 2).map((d) => d.label).join(" | ");
            return (
              <section key={cluster.cluster_id} className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4">
                <div className="mb-3">
                  <h2 className="text-xl font-semibold text-[#4F6420]">
                    {cluster.cluster_name} {cluster.mood_label ? <span className="text-sm font-normal">[{cluster.mood_label}]</span> : null}
                  </h2>
                  <p className="text-sm text-[#4F6420]/80">
                    Cluster {cluster.cluster_id} | Size {cluster.size}
                    {topDescriptors ? ` | ${topDescriptors}` : ""}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {clusterImages.map((img) => {
                    const rel = `step_a/${img.path}`;
                    const src = buildDemoAssetUrl(base, albumId || "", rel);
                    const topTag = img.styles_topk && img.styles_topk[0] ? img.styles_topk[0].tag : "";
                    return (
                      <div key={`${cluster.cluster_id}-${img.rank_in_cluster}-${img.path}`} className="relative rounded-md overflow-hidden border border-[#A7B580] bg-white">
                        <img src={src} alt={img.path} className="w-full h-36 object-cover" loading="lazy" decoding="async" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[11px] px-2 py-1">
                          <div>#{img.rank_in_cluster} | {img.pref_score.toFixed(3)}</div>
                          <div className="truncate">{topTag}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
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
    </ResultsLayout>
  );
}
