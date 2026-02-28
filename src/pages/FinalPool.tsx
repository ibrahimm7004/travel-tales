import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildAssetUrl, buildDemoAssetUrl, resolveAlbumIdFromQueryOrSession, withAlbumId } from "@/pages/results/demoHelpers";
import { ResultsLayout } from "@/pages/results/ResultsLayout";

type StepCCluster = {
  cluster_id: number;
  elo: number;
  ratio: number;
  keep_count: number;
};

type StepCState = {
  albumId: string;
  done: boolean;
  stop_reason?: string | null;
  clusters: StepCCluster[];
};

type StepBImage = {
  path: string;
  cluster_id: number;
  rank_in_cluster: number;
};

type StepBCluster = {
  cluster_id: number;
  size?: number;
  cluster_name?: string;
};

type LightboxItem = {
  src: string;
  label: string;
  rank: number;
  clusterId: number;
};

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function imageSort(a: StepBImage, b: StepBImage): number {
  const r = toNum(a.rank_in_cluster, Number.MAX_SAFE_INTEGER) - toNum(b.rank_in_cluster, Number.MAX_SAFE_INTEGER);
  if (r !== 0) return r;
  return String(a.path || "").localeCompare(String(b.path || ""));
}

function asAssetRel(path: string): string {
  const p = String(path || "").replaceAll("\\", "/");
  return p.startsWith("step_a/") ? p : `step_a/${p}`;
}

type StripProps = {
  title: string;
  items: StepBImage[];
  albumId: string;
  base: string;
  emptyText: string;
  onOpen: (item: LightboxItem) => void;
  label: "Accepted" | "Rejected";
};

function ImageStrip({ title, items, albumId, base, emptyText, onOpen, label }: StripProps) {
  return (
    <div className="rounded-lg border border-[#A7B580] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#4F6420]">{title}</p>
        <p className="text-xs text-[#4F6420]/70">{items.length}</p>
      </div>
      {items.length === 0 ? (
        <div className="h-28 flex items-center justify-center rounded-md border border-dashed border-[#C4CFAB] text-xs text-[#4F6420]/70">
          {emptyText}
        </div>
      ) : (
        <div className="relative">
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max gap-3 pr-8">
              {items.map((img) => {
                const rel = asAssetRel(img.path);
                const thumbSrc = buildDemoAssetUrl(base, albumId, rel);
                const fullSrc = buildAssetUrl(base, albumId, rel);
                const rank = toNum(img.rank_in_cluster, 0);
                return (
                  <button
                    key={`${img.cluster_id}-${img.path}-${rank}`}
                    type="button"
                    onClick={() => onOpen({ src: fullSrc, label, rank, clusterId: toNum(img.cluster_id) })}
                    className="group relative w-36 shrink-0 overflow-hidden rounded-md border border-[#A7B580] bg-[#F9F9F5] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md md:w-44"
                  >
                    <img
                      src={thumbSrc}
                      alt={`${label} rank ${rank}`}
                      loading="lazy"
                      decoding="async"
                      className="h-24 w-full object-cover md:h-28"
                    />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      #{rank}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white/90 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white/90 to-transparent" />
        </div>
      )}
    </div>
  );
}

export default function FinalPool() {
  const location = useLocation();
  const navigate = useNavigate();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [stepC, setStepC] = useState<StepCState | null>(null);
  const [images, setImages] = useState<StepBImage[]>([]);
  const [clusters, setClusters] = useState<StepBCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  useEffect(() => {
    const id = resolveAlbumIdFromQueryOrSession(location.search);
    if (!id) {
      setError("Could not resolve albumId.");
      setLoading(false);
      return;
    }
    setAlbumId(id);
  }, [location.search]);

  useEffect(() => {
    if (!albumId || !base) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const stepCRes = await fetch(`${base}/processing/post-upload/step-c/state?albumId=${encodeURIComponent(albumId)}`);
        if (!stepCRes.ok) {
          const text = await stepCRes.text().catch(() => "");
          throw new Error(text || "Failed to load Step C state.");
        }
        const stepCJson = (await stepCRes.json()) as StepCState;
        if (cancelled) return;
        setStepC(stepCJson);

        if (!stepCJson.done) {
          setImages([]);
          setClusters([]);
          setError(null);
          return;
        }

        const [imagesRes, clustersRes] = await Promise.all([
          fetch(`${base}/processing/post-upload/step-b/images?albumId=${encodeURIComponent(albumId)}`),
          fetch(`${base}/processing/post-upload/step-b/clusters?albumId=${encodeURIComponent(albumId)}`),
        ]);
        if (!imagesRes.ok) {
          const text = await imagesRes.text().catch(() => "");
          throw new Error(text || "Failed to load Step B images.");
        }
        if (!clustersRes.ok) {
          const text = await clustersRes.text().catch(() => "");
          throw new Error(text || "Failed to load Step B clusters.");
        }
        const imagesJson = await imagesRes.json();
        const clustersJson = await clustersRes.json();
        if (cancelled) return;
        const imageRows: StepBImage[] = Array.isArray(imagesJson?.items) ? imagesJson.items : [];
        const clusterRows: StepBCluster[] = Array.isArray(clustersJson?.items) ? clustersJson.items : [];
        imageRows.sort((a, b) => {
          const c = toNum(a.cluster_id) - toNum(b.cluster_id);
          if (c !== 0) return c;
          return imageSort(a, b);
        });
        clusterRows.sort((a, b) => toNum(a.cluster_id) - toNum(b.cluster_id));
        setImages(imageRows);
        setClusters(clusterRows);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Failed to load final pool.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [albumId, base]);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  const clusterMetaById = useMemo(() => {
    const m = new Map<number, StepBCluster>();
    for (const c of clusters) m.set(toNum(c.cluster_id), c);
    return m;
  }, [clusters]);

  const imagesByCluster = useMemo(() => {
    const m = new Map<number, StepBImage[]>();
    for (const row of images) {
      const cid = toNum(row.cluster_id);
      const list = m.get(cid) || [];
      list.push(row);
      m.set(cid, list);
    }
    for (const [cid, rows] of m.entries()) {
      rows.sort(imageSort);
      m.set(cid, rows);
    }
    return m;
  }, [images]);

  const keepByCluster = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of stepC?.clusters || []) {
      m.set(toNum(c.cluster_id), Math.max(0, toNum(c.keep_count)));
    }
    return m;
  }, [stepC?.clusters]);

  const orderedClusters = useMemo(() => {
    const byId = new Map<number, StepCCluster>();
    for (const c of stepC?.clusters || []) byId.set(toNum(c.cluster_id), c);
    const ids = new Set<number>();
    for (const c of stepC?.clusters || []) ids.add(toNum(c.cluster_id));
    for (const c of clusters) ids.add(toNum(c.cluster_id));
    for (const [cid] of imagesByCluster.entries()) ids.add(cid);
    return [...ids]
      .map((id) => ({ id, c: byId.get(id) }))
      .sort((a, b) => {
        const eloCmp = toNum(b.c?.elo, Number.NEGATIVE_INFINITY) - toNum(a.c?.elo, Number.NEGATIVE_INFINITY);
        if (eloCmp !== 0) return eloCmp;
        return a.id - b.id;
      });
  }, [stepC?.clusters, clusters, imagesByCluster]);

  const missingKeepIds = useMemo(
    () => orderedClusters.map((x) => x.id).filter((cid) => !keepByCluster.has(cid)),
    [orderedClusters, keepByCluster],
  );

  return (
    <ResultsLayout testId="final-pool-page" title="Final Pool" albumId={albumId}>
      <div className="mb-5 rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Album: {albumId || "Not found"}</p>
          <p className="text-xs text-[#4F6420]/75">Derived from Step B ranks and Step C allocation</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(withAlbumId("/results/step-c", albumId))}
          className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]"
        >
          Back to Step C
        </button>
      </div>

      {loading ? <div className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">Loading final pool...</div> : null}
      {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div> : null}

      {!loading && stepC && !stepC.done ? (
        <div className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-5 text-[#4F6420]">
          <p className="font-semibold">Complete contests to generate final pool.</p>
          <p className="text-sm text-[#4F6420]/80 mt-1">{stepC.stop_reason || "Step C is still running."}</p>
          <button
            type="button"
            onClick={() => navigate(withAlbumId("/results/step-c", albumId))}
            className="mt-3 inline-flex items-center justify-center px-4 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]"
          >
            Go to Step C
          </button>
        </div>
      ) : null}

      {!loading && stepC?.done && missingKeepIds.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm">
          Missing final keep_count for cluster(s): {missingKeepIds.join(", ")}. Those clusters default to 0 accepted.
        </div>
      ) : null}

      {!loading && stepC?.done ? (
        <div className="space-y-4">
          {orderedClusters.map(({ id, c }) => {
            const rows = (imagesByCluster.get(id) || []).slice().sort(imageSort);
            const keepRaw = keepByCluster.has(id) ? toNum(keepByCluster.get(id), 0) : 0;
            const keepFinal = Math.max(0, Math.min(rows.length, keepRaw));
            const accepted = rows.slice(0, keepFinal);
            const rejected = rows.slice(keepFinal);
            const meta = clusterMetaById.get(id);
            const clusterSize = Math.max(toNum(meta?.size, rows.length), rows.length);
            const ratioPct = toNum(c?.ratio) * 100;
            return (
              <section key={id} className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-[#4F6420]">Cluster #{id}</h2>
                    {meta?.cluster_name ? <p className="text-xs text-[#4F6420]/70">{meta.cluster_name}</p> : null}
                  </div>
                  <div className="text-right text-sm text-[#4F6420]">
                    <p className="font-semibold">Final: {accepted.length}/{clusterSize}</p>
                    <p className="text-xs text-[#4F6420]/75">{ratioPct.toFixed(1)}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.35fr] gap-3">
                  <ImageStrip
                    title="Rejected"
                    items={rejected}
                    albumId={albumId || ""}
                    base={base}
                    emptyText="No rejected images in this cluster."
                    label="Rejected"
                    onOpen={setLightbox}
                  />
                  <ImageStrip
                    title="Accepted"
                    items={accepted}
                    albumId={albumId || ""}
                    base={base}
                    emptyText="No accepted images in this cluster."
                    label="Accepted"
                    onOpen={setLightbox}
                  />
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[90] bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-w-5xl w-full rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between text-[#4F6420] text-sm">
              <p>{lightbox.label} | Cluster #{lightbox.clusterId} | Rank #{lightbox.rank}</p>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="px-2 py-1 rounded border border-[#A7B580] bg-white hover:bg-[#E8EBD1]"
              >
                Close
              </button>
            </div>
            <img src={lightbox.src} alt={`Cluster ${lightbox.clusterId} rank ${lightbox.rank}`} className="w-full max-h-[78vh] object-contain rounded-md bg-black/10" />
          </div>
        </div>
      ) : null}
    </ResultsLayout>
  );
}

