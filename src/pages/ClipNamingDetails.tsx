// DEMO ONLY, safe to delete.
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildAssetUrl,
  fetchTextPreview,
  isTextArtifact,
  probeAssetPaths,
  resolveAlbumIdFromQueryOrSession,
  withAlbumId,
  type PostUploadStatus,
} from "@/pages/results/demoHelpers";
import { ResultsLayout } from "@/pages/results/ResultsLayout";

const POLL_MS = 2000;
const CLIP_PROBE_PATHS = [
  "step_b/step_b_clusters.jsonl",
  "step_b/step_b_images.jsonl",
  "step_b/step_b_kmeans.jsonl",
  "step_b/step_b_kmeans_clusters.jsonl",
  "step_b/cache/meta.json",
  "step_b/cache/paths_index.json",
  "step_b/cache/clip_text_meta.json",
  "step_b/cache/clip_desc_meta.json",
  "logs/step_b.log",
];

type ClusterItem = Record<string, any>;

export default function ClipNamingDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [status, setStatus] = useState<PostUploadStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [probed, setProbed] = useState<Record<string, boolean>>({});
  const [selectedRel, setSelectedRel] = useState<string>("");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewMeta, setPreviewMeta] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);

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
        if (data.status === "error" || data.status === "done_b") {
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
      const map = await probeAssetPaths(base, albumId, CLIP_PROBE_PATHS);
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
    let active = true;
    const run = async () => {
      try {
        const res = await fetch(`${base}/processing/post-upload/step-b/clusters?albumId=${encodeURIComponent(albumId)}`);
        if (!res.ok) {
          if (status?.status !== "done_b") return;
          throw new Error("Step B clusters are not available.");
        }
        const data = await res.json();
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        items.sort((a: any, b: any) => Number(a?.cluster_id || 0) - Number(b?.cluster_id || 0));
        setClusters(items);
      } catch (err: any) {
        if (!active) return;
        if (status?.status === "done_b") {
          setLoadError(err?.message || "Failed to load clusters.");
        }
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [albumId, base, status?.status]);

  const availableArtifacts = useMemo(() => CLIP_PROBE_PATHS.filter((rel) => probed[rel]), [probed]);
  const previewables = useMemo(() => availableArtifacts.filter((rel) => isTextArtifact(rel)), [availableArtifacts]);
  const statusLabel = (status?.status || "waiting").replaceAll("_", " ");

  useEffect(() => {
    if (!selectedRel && previewables.length > 0) {
      setSelectedRel(previewables[0]);
    }
  }, [selectedRel, previewables]);

  useEffect(() => {
    if (!albumId || !base || !selectedRel) return;
    let active = true;
    const run = async () => {
      try {
        const preview = await fetchTextPreview(base, albumId, selectedRel);
        if (!active) return;
        setPreviewText(preview.text);
        setPreviewMeta(`Showing first ${preview.lineCount} lines / ${preview.byteCount} bytes${preview.truncated ? " (truncated)" : ""}`);
        setPreviewError(null);
      } catch (err: any) {
        if (!active) return;
        setPreviewText("");
        setPreviewMeta("");
        setPreviewError(err?.message || "Failed to load preview.");
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [albumId, base, selectedRel]);

  return (
    <ResultsLayout testId="clip-naming-details-page" title="CLIP Naming Details" albumId={albumId}>
      <div className="mb-6 rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">
        <p className="font-medium">
          Status: {statusLabel}{status?.progress != null ? ` - ${Math.round(status.progress * 100)}%` : ""}
        </p>
        <p className="text-sm text-[#4F6420]/80 mt-1">
          Demo explainer: DINO clusters group visual similarity first, then CLIP scores style/descriptor prompts and final cluster names.
        </p>
        {loadError ? <p className="text-sm text-red-700 mt-2">{loadError}</p> : null}
      </div>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-3">Cluster Evidence</h2>
        {clusters.length === 0 ? (
          <p className="text-sm text-[#4F6420]/80">Cluster evidence is not available yet for this album.</p>
        ) : (
          <div className="space-y-3">
            {clusters.map((cluster, idx) => {
              const styleScores = Array.isArray(cluster?.cluster_style_scores) ? cluster.cluster_style_scores : [];
              const descScores = Array.isArray(cluster?.cluster_desc_topk) ? cluster.cluster_desc_topk : [];
              const fields = Object.keys(cluster || {}).sort();
              return (
                <details key={`${cluster?.cluster_id ?? idx}`} className="rounded-lg border border-[#D5DCC0] bg-white p-3">
                  <summary className="cursor-pointer font-medium text-[#4F6420]">
                    Cluster {cluster?.cluster_id ?? idx} - {String(cluster?.cluster_name || "Untitled")}
                  </summary>
                  <div className="mt-3 space-y-2 text-sm text-[#4F6420]/90">
                    <p>Mood label: {String(cluster?.mood_label || "n/a")}</p>
                    <p>Styles used: {styleScores.slice(0, 4).map((row: any) => `${row?.tag} (${Number(row?.score || 0).toFixed(3)})`).join(" | ") || "n/a"}</p>
                    <p>Descriptors: {descScores.map((row: any) => `${row?.label} (${Number(row?.score || 0).toFixed(3)})`).join(" | ") || "n/a"}</p>
                    <p>Representatives: {Array.isArray(cluster?.representatives) ? cluster.representatives.join(", ") : "n/a"}</p>
                    <p>Stored fields: {fields.join(", ")}</p>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-3">Artifacts</h2>
        {availableArtifacts.length === 0 ? (
          <p className="text-sm text-[#4F6420]/80">No CLIP naming artifacts found yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {availableArtifacts.map((rel) => (
              <li key={rel}>
                <a className="underline text-[#4F6420]" href={buildAssetUrl(base, albumId || "", rel)} target="_blank" rel="noreferrer">
                  {rel}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-[#4F6420]">Preview</h2>
          <select
            className="text-sm border border-[#A7B580] rounded-md px-2 py-1 bg-white"
            value={selectedRel}
            onChange={(e) => setSelectedRel(e.target.value)}
          >
            <option value="">Select artifact</option>
            {previewables.map((rel) => (
              <option key={rel} value={rel}>{rel}</option>
            ))}
          </select>
        </div>
        {previewMeta ? <p className="text-xs text-[#4F6420]/70 mb-2">{previewMeta}</p> : null}
        {previewError ? <p className="text-sm text-red-700">{previewError}</p> : null}
        {previewText ? (
          <pre className="text-xs whitespace-pre-wrap bg-white border border-[#D5DCC0] rounded p-3 max-h-96 overflow-auto">{previewText}</pre>
        ) : (
          <p className="text-sm text-[#4F6420]/80">Choose an artifact to preview.</p>
        )}
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

