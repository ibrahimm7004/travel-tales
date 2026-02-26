// DEMO ONLY, safe to delete.
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildAssetUrl,
  buildDemoAssetUrl,
  fetchTextPreview,
  probeAssetPaths,
  resolveAlbumIdFromQueryOrSession,
  withAlbumId,
  type PostUploadStatus,
} from "@/pages/results/demoHelpers";
import { ResultsLayout } from "@/pages/results/ResultsLayout";

const POLL_MS = 2000;
const DINO_PROBE_PATHS = [
  "step_b/step_b_kmeans.jsonl",
  "step_b/step_b_kmeans_clusters.jsonl",
  "logs/step_b.log",
];

type KMeansRow = {
  path: string;
  cluster_id: number;
  kmeans_dist: number;
};

type KMeansClusterRow = {
  cluster_id: number;
  size: number;
  representatives?: string[];
};

function parseJsonl<T>(text: string): T[] {
  const rows: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // ignore malformed lines
    }
  }
  return rows;
}

export default function DINOOnlyResults() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [status, setStatus] = useState<PostUploadStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probed, setProbed] = useState<Record<string, boolean>>({});
  const [kmeansRows, setKmeansRows] = useState<KMeansRow[]>([]);
  const [clusterRows, setClusterRows] = useState<KMeansClusterRow[]>([]);
  const [activeClusterId, setActiveClusterId] = useState<number | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState(false);

  useEffect(() => {
    const id = resolveAlbumIdFromQueryOrSession(location.search);
    if (id) setAlbumId(id);
    else setLoadError("No active upload session found.");
  }, [location.search]);

  useEffect(() => {
    if (!albumId || !base) return;
    let isActive = true;
    let intervalId: number | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`${base}/processing/post-upload/status?albumId=${encodeURIComponent(albumId)}`);
        if (!res.ok) throw new Error("Failed to fetch status.");
        const data = (await res.json()) as PostUploadStatus;
        if (!isActive) return;
        setStatus(data);
        if (data.status === "error" || data.status === "done_b" || data.status === "waiting_user_moods" || data.status === "running_b_clip") {
          if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err: any) {
        if (!isActive) return;
        setLoadError(err?.message || "Could not load status.");
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
    if (!albumId || !base) return;
    let isActive = true;
    const run = async () => {
      const map = await probeAssetPaths(base, albumId, DINO_PROBE_PATHS);
      if (!isActive) return;
      setProbed(map);
    };
    run();
    return () => {
      isActive = false;
    };
  }, [albumId, base, status?.status]);

  useEffect(() => {
    if (!albumId || !base) return;
    if (!probed["step_b/step_b_kmeans.jsonl"] || !probed["step_b/step_b_kmeans_clusters.jsonl"]) return;
    let active = true;
    const run = async () => {
      try {
        const [rowsPreview, clustersPreview] = await Promise.all([
          fetchTextPreview(base, albumId, "step_b/step_b_kmeans.jsonl", 8000, 1024 * 1024),
          fetchTextPreview(base, albumId, "step_b/step_b_kmeans_clusters.jsonl", 4000, 512 * 1024),
        ]);
        if (!active) return;
        const rows = parseJsonl<KMeansRow>(rowsPreview.text);
        const clusters = parseJsonl<KMeansClusterRow>(clustersPreview.text);
        rows.sort((a, b) => (a.cluster_id - b.cluster_id) || (a.kmeans_dist - b.kmeans_dist) || a.path.localeCompare(b.path));
        clusters.sort((a, b) => a.cluster_id - b.cluster_id);
        setKmeansRows(rows);
        setClusterRows(clusters);
        setPreviewTruncated(rowsPreview.truncated || clustersPreview.truncated);
      } catch (err: any) {
        if (!active) return;
        setLoadError(err?.message || "Failed to load DINO artifacts.");
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [albumId, base, probed]);

  useEffect(() => {
    if (activeClusterId != null) return;
    if (clusterRows.length > 0) {
      setActiveClusterId(clusterRows[0].cluster_id);
    }
  }, [activeClusterId, clusterRows]);

  const clustersById = useMemo(() => {
    const out = new Map<number, KMeansClusterRow>();
    for (const c of clusterRows) out.set(c.cluster_id, c);
    return out;
  }, [clusterRows]);

  const imagesByCluster = useMemo(() => {
    const out = new Map<number, KMeansRow[]>();
    for (const row of kmeansRows) {
      const list = out.get(row.cluster_id) || [];
      list.push(row);
      out.set(row.cluster_id, list);
    }
    return out;
  }, [kmeansRows]);

  const activeRows = activeClusterId == null ? [] : (imagesByCluster.get(activeClusterId) || []);
  const statusLabel = (status?.status || "waiting").replaceAll("_", " ");

  return (
    <ResultsLayout testId="dino-only-results-page" title="DINO Clusters (pre-CLIP)" albumId={albumId}>
      <div className="mb-6 rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">
        <p className="font-medium">
          Status: {statusLabel}{status?.progress != null ? ` - ${Math.round(status.progress * 100)}%` : ""}
        </p>
        <p className="text-sm text-[#4F6420]/80 mt-1">
          Phase-1 only: DINO embeddings + KMeans assignment. No CLIP scoring or final naming.
        </p>
        {previewTruncated ? <p className="text-xs text-[#4F6420]/70 mt-2">Large artifacts were preview-capped for safety.</p> : null}
        {loadError ? <p className="text-sm text-red-700 mt-2">{loadError}</p> : null}
      </div>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-2">Cluster Selector</h2>
        {clusterRows.length === 0 ? (
          <p className="text-sm text-[#4F6420]/80">DINO cluster artifacts are not available yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {clusterRows.map((cluster) => {
              const isActive = activeClusterId === cluster.cluster_id;
              return (
                <button
                  key={cluster.cluster_id}
                  type="button"
                  onClick={() => setActiveClusterId(cluster.cluster_id)}
                  className={`px-3 py-1.5 rounded-full border text-sm ${isActive ? "bg-[#4F6420] text-white border-[#4F6420]" : "bg-white text-[#4F6420] border-[#A7B580]"}`}
                >
                  cluster {cluster.cluster_id} ({cluster.size})
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-2">Cluster Gallery</h2>
        {activeClusterId == null ? (
          <p className="text-sm text-[#4F6420]/80">Select a cluster to view its images.</p>
        ) : (
          <>
            <p className="text-sm text-[#4F6420]/80 mb-3">
              cluster_id: {activeClusterId} | size: {clustersById.get(activeClusterId)?.size ?? activeRows.length}
            </p>
            <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
              {activeRows.map((row) => {
                const rel = `step_a/${row.path}`;
                const src = buildDemoAssetUrl(base, albumId || "", rel);
                const reps = clustersById.get(row.cluster_id)?.representatives || [];
                const isRepresentative = reps.includes(row.path);
                return (
                  <article key={`${row.cluster_id}-${row.path}`} className="snap-start shrink-0 w-64 rounded-lg border border-[#D5DCC0] bg-white overflow-hidden">
                    <img src={src} alt={row.path} className="w-full h-40 object-cover" loading="lazy" decoding="async" />
                    <div className="p-3 text-xs text-[#4F6420]/90 space-y-1">
                      <p className="font-semibold truncate" title={row.path}>{row.path.split("/").pop()}</p>
                      <p>cluster_id: {row.cluster_id}</p>
                      <p>kmeans_dist: {Number(row.kmeans_dist).toFixed(6)}</p>
                      <p>representative: {isRepresentative ? "yes" : "no"}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-2">Artifacts</h2>
        <ul className="text-sm space-y-1">
          {DINO_PROBE_PATHS.map((rel) => (
            <li key={rel}>
              {probed[rel] ? (
                <a className="underline text-[#4F6420]" href={buildAssetUrl(base, albumId || "", rel)} target="_blank" rel="noreferrer">{rel}</a>
              ) : (
                <span className="text-[#4F6420]/60">{rel} (missing)</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => navigate(withAlbumId("/results/step-b", albumId))}
          className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]"
        >
          Back to Step B Results
        </button>
      </div>
    </ResultsLayout>
  );
}
