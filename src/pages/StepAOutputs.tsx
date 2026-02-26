// DEMO ONLY, safe to delete.
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildAssetUrl,
  buildDemoAssetUrl,
  fetchTextPreview,
  isTextArtifact,
  probeAssetPaths,
  resolveAlbumIdFromQueryOrSession,
  withAlbumId,
  type PostUploadStatus,
} from "@/pages/results/demoHelpers";
import { ResultsLayout } from "@/pages/results/ResultsLayout";

const STEP_A_READY_STATES = new Set(["done_a", "running_b_dino", "waiting_user_moods", "running_b_clip", "done_b"]);
const POLL_MS = 2000;
const STEP_A_PROBE_PATHS = [
  "inputs_manifest.json",
  "step_a/dedupe.jsonl",
  "step_a/step_a_manifest.jsonl",
  "step_a/quality.jsonl",
  "logs/step_a.log",
  "post_upload_status.json",
];

type DedupeRow = { path: string; group_id: number; representative: boolean; phash?: string };
type InputsManifestRow = { local_path_rel?: string };
type QualityPayload = {
  sharp_vlap?: number;
  exp_mean?: number;
  blurry?: boolean;
  underexposed?: boolean;
  overexposed?: boolean;
};
type QualityRow = { path: string } & QualityPayload;
type ManifestMember = { src_path?: string; quality?: QualityPayload };
type ManifestExport = { src_path?: string; export_path?: string };
type StepAManifestRecord = {
  group_id?: number;
  primary?: ManifestExport | null;
  secondary?: ManifestExport | null;
  tertiary?: ManifestExport | null;
  members_ranked?: ManifestMember[];
};
type GroupImage = {
  rel: string;
  srcPath: string;
  groupId: number;
  role: "primary" | "secondary" | "tertiary" | "rejected";
  representative: boolean;
  phash: string;
  quality: QualityPayload | null;
};
type GroupBucket = { groupId: number; images: GroupImage[] };

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function baseName(value: string): string {
  const norm = value.replaceAll("\\", "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function parseJsonl<T>(text: string): T[] {
  const rows: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // ignore malformed rows
    }
  }
  return rows;
}

function parseInputsManifest(text: string): InputsManifestRow[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

function qualityNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function qualityBool(v: any): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function coerceQuality(raw: any): QualityPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const out: QualityPayload = {};
  const sv = qualityNum((raw as any).sharp_vlap);
  const em = qualityNum((raw as any).exp_mean);
  const bl = qualityBool((raw as any).blurry);
  const ue = qualityBool((raw as any).underexposed);
  const oe = qualityBool((raw as any).overexposed);
  if (sv != null) out.sharp_vlap = sv;
  if (em != null) out.exp_mean = em;
  if (bl != null) out.blurry = bl;
  if (ue != null) out.underexposed = ue;
  if (oe != null) out.overexposed = oe;
  return Object.keys(out).length > 0 ? out : null;
}

export default function StepAOutputs() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [status, setStatus] = useState<PostUploadStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probed, setProbed] = useState<Record<string, boolean>>({});
  const [selectedRel, setSelectedRel] = useState<string>("");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewMeta, setPreviewMeta] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [groups, setGroups] = useState<GroupBucket[]>([]);
  const [groupLoadError, setGroupLoadError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string>("");

  useEffect(() => {
    const id = resolveAlbumIdFromQueryOrSession(location.search);
    if (id) {
      setAlbumId(id);
    } else {
      setLoadError("No active upload session found.");
    }
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
        if (data.status === "error" || data.status === "done_b" || data.status === "done_a") {
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
      const map = await probeAssetPaths(base, albumId, STEP_A_PROBE_PATHS);
      if (!isActive) return;
      setProbed(map);
    };
    run();
    return () => {
      isActive = false;
    };
  }, [albumId, base, status?.status]);

  const ready = STEP_A_READY_STATES.has(status?.status || "");
  const availablePaths = useMemo(() => STEP_A_PROBE_PATHS.filter((rel) => probed[rel]), [probed]);
  const previewables = useMemo(() => availablePaths.filter((rel) => isTextArtifact(rel)), [availablePaths]);
  const statusLabel = (status?.status || "waiting").replaceAll("_", " ");

  useEffect(() => {
    if (!selectedRel && previewables.length > 0) {
      setSelectedRel(previewables[0]);
    }
  }, [selectedRel, previewables]);

  useEffect(() => {
    if (!albumId || !base || !selectedRel) return;
    let active = true;
    const load = async () => {
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
    load();
    return () => {
      active = false;
    };
  }, [albumId, base, selectedRel]);

  useEffect(() => {
    if (!albumId || !base || !probed["step_a/dedupe.jsonl"] || !probed["step_a/step_a_manifest.jsonl"]) return;
    let active = true;
    const load = async () => {
      try {
        const [dedupePreview, manifestPreview, qualityPreview, inputsPreview] = await Promise.all([
          fetchTextPreview(base, albumId, "step_a/dedupe.jsonl", 20000, 2 * 1024 * 1024),
          fetchTextPreview(base, albumId, "step_a/step_a_manifest.jsonl", 10000, 2 * 1024 * 1024),
          probed["step_a/quality.jsonl"] ? fetchTextPreview(base, albumId, "step_a/quality.jsonl", 20000, 2 * 1024 * 1024) : Promise.resolve(null),
          probed["inputs_manifest.json"] ? fetchTextPreview(base, albumId, "inputs_manifest.json", 5000, 512 * 1024) : Promise.resolve(null),
        ]);

        const dedupeRows = parseJsonl<DedupeRow>(dedupePreview.text);
        const manifestRows = parseJsonl<StepAManifestRecord>(manifestPreview.text);
        const qualityRows = qualityPreview ? parseJsonl<QualityRow>(qualityPreview.text) : [];
        const inputsRows = inputsPreview ? parseInputsManifest(inputsPreview.text) : [];

        const relByBase = new Map<string, string>();
        for (const row of inputsRows) {
          const rel = typeof row?.local_path_rel === "string" ? row.local_path_rel : "";
          if (!rel) continue;
          relByBase.set(baseName(rel), rel);
        }

        const qualityByNorm = new Map<string, QualityPayload>();
        const qualityByBase = new Map<string, QualityPayload>();
        for (const row of qualityRows) {
          if (!row?.path) continue;
          const q = coerceQuality(row);
          if (!q) continue;
          qualityByNorm.set(normalizePath(row.path), q);
          qualityByBase.set(baseName(row.path), q);
        }

        const roleBySrcNorm = new Map<string, GroupImage["role"]>();
        const qualityBySrcNorm = new Map<string, QualityPayload>();
        for (const row of manifestRows) {
          const registerRole = (src: string | undefined, role: GroupImage["role"]) => {
            if (!src) return;
            roleBySrcNorm.set(normalizePath(src), role);
          };
          registerRole(row?.primary?.src_path, "primary");
          registerRole(row?.secondary?.src_path, "secondary");
          registerRole(row?.tertiary?.src_path, "tertiary");
          for (const member of row?.members_ranked || []) {
            if (!member?.src_path) continue;
            const q = coerceQuality(member.quality);
            if (!q) continue;
            qualityBySrcNorm.set(normalizePath(member.src_path), q);
          }
        }

        const bucketMap = new Map<number, GroupImage[]>();
        for (const row of dedupeRows) {
          const gid = Number(row?.group_id);
          if (!Number.isFinite(gid) || !row?.path) continue;
          const rel = relByBase.get(baseName(row.path)) || `inputs/${baseName(row.path)}`;
          const srcNorm = normalizePath(row.path);
          const quality = qualityByNorm.get(srcNorm)
            || qualityBySrcNorm.get(srcNorm)
            || qualityByBase.get(baseName(row.path))
            || null;
          const role = roleBySrcNorm.get(srcNorm) || (row.representative ? "primary" : "rejected");
          const item: GroupImage = {
            rel,
            srcPath: row.path,
            groupId: gid,
            role,
            representative: !!row.representative,
            phash: typeof row?.phash === "string" ? row.phash : "n/a",
            quality,
          };
          const list = bucketMap.get(gid) || [];
          list.push(item);
          bucketMap.set(gid, list);
        }

        const roleRank = (role: GroupImage["role"]) => (role === "primary" ? 0 : role === "secondary" ? 1 : role === "tertiary" ? 2 : 3);
        const buckets: GroupBucket[] = Array.from(bucketMap.entries())
          .map(([groupId, images]) => ({
            groupId,
            images: images.sort((a, b) => {
              const r = roleRank(a.role) - roleRank(b.role);
              if (r !== 0) return r;
              return a.rel.localeCompare(b.rel);
            }),
          }))
          .sort((a, b) => a.groupId - b.groupId);

        if (!active) return;
        setGroups(buckets);
        setGroupLoadError((dedupePreview.truncated || manifestPreview.truncated || !!qualityPreview?.truncated)
          ? "Large artifacts were preview-capped; some rows may be omitted in this view."
          : null);
      } catch (err: any) {
        if (!active) return;
        setGroups([]);
        setGroupLoadError(err?.message || "Failed to load Step A grouping artifacts.");
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [albumId, base, probed]);

  const duplicateGroups = useMemo(() => groups.filter((g) => g.images.length > 1), [groups]);
  const othersImages = useMemo(() => groups.filter((g) => g.images.length <= 1).flatMap((g) => g.images), [groups]);

  useEffect(() => {
    if (activeKey) return;
    if (duplicateGroups.length > 0) {
      setActiveKey(`group:${duplicateGroups[0].groupId}`);
      return;
    }
    if (othersImages.length > 0) {
      setActiveKey("others");
    }
  }, [activeKey, duplicateGroups, othersImages]);

  const activeImages = useMemo(() => {
    if (activeKey === "others") return othersImages;
    if (activeKey.startsWith("group:")) {
      const gid = Number(activeKey.slice(6));
      return groups.find((g) => g.groupId === gid)?.images || [];
    }
    return [];
  }, [activeKey, groups, othersImages]);

  const qualityLabel = (q: QualityPayload | null) => {
    if (!q) return "quality unavailable";
    const sv = q.sharp_vlap != null ? q.sharp_vlap.toFixed(3) : "n/a";
    const em = q.exp_mean != null ? q.exp_mean.toFixed(3) : "n/a";
    const bl = q.blurry == null ? "n/a" : q.blurry ? "yes" : "no";
    const ue = q.underexposed == null ? "n/a" : q.underexposed ? "yes" : "no";
    const oe = q.overexposed == null ? "n/a" : q.overexposed ? "yes" : "no";
    return `sharp_vlap: ${sv} | exp_mean: ${em} | blurry: ${bl} | under: ${ue} | over: ${oe}`;
  };

  return (
    <ResultsLayout testId="step-a-outputs-page" title="Step A Outputs" albumId={albumId}>
      <div className="mb-6 rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">
        <p className="font-medium">
          Status: {statusLabel}{status?.progress != null ? ` - ${Math.round(status.progress * 100)}%` : ""}
        </p>
        <p className="text-sm text-[#4F6420]/80 mt-1">
          End of Step A: dedupe grouping + representative selection final pool.
        </p>
        {loadError ? <p className="text-sm text-red-700 mt-2">{loadError}</p> : null}
      </div>

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-2">Dedup Group Explorer</h2>
        <p className="text-sm text-[#4F6420]/80 mb-3">
          Select a duplicate group button to inspect accepted/rejected images. Groups with one image are grouped under "Others".
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {duplicateGroups.map((group) => {
            const key = `group:${group.groupId}`;
            const active = activeKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveKey(key)}
                className={`px-3 py-1.5 rounded-full border text-sm ${active ? "bg-[#4F6420] text-white border-[#4F6420]" : "bg-white text-[#4F6420] border-[#A7B580]"}`}
              >
                Group {group.groupId} ({group.images.length})
              </button>
            );
          })}
          {othersImages.length > 0 ? (
            <button
              type="button"
              onClick={() => setActiveKey("others")}
              className={`px-3 py-1.5 rounded-full border text-sm ${activeKey === "others" ? "bg-[#4F6420] text-white border-[#4F6420]" : "bg-white text-[#4F6420] border-[#A7B580]"}`}
            >
              Others ({othersImages.length})
            </button>
          ) : null}
        </div>

        {activeImages.length === 0 ? (
          <p className="text-sm text-[#4F6420]/80">No group selected.</p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
            {activeImages.map((item, idx) => {
              const src = buildDemoAssetUrl(base, albumId || "", item.rel);
              const accepted = item.role !== "rejected";
              return (
                <article key={`${item.groupId}-${item.rel}-${idx}`} className="snap-start shrink-0 w-64 rounded-lg border border-[#D5DCC0] bg-white overflow-hidden">
                  <img src={src} alt={item.rel} className="w-full h-40 object-cover" loading="lazy" decoding="async" />
                  <div className="p-3 text-xs text-[#4F6420]/90 space-y-1">
                    <p className="font-semibold truncate" title={item.rel}>{item.rel.split("/").pop()}</p>
                    <p>group: {item.groupId} | role: {item.role} | accepted: {accepted ? "yes" : "no"}</p>
                    <p>representative flag: {item.representative ? "true" : "false"}</p>
                    <p>phash: {item.phash}</p>
                    <p className="break-words">{qualityLabel(item.quality)}</p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {groupLoadError ? <p className="text-xs text-[#4F6420]/70 mt-3">{groupLoadError}</p> : null}
      </section>

      {ready ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-6">
          <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
            <p className="text-[#4F6420]/70">Uploaded</p>
            <p className="font-semibold text-[#4F6420]">{status?.counts?.uploaded_count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
            <p className="text-[#4F6420]/70">Staged</p>
            <p className="font-semibold text-[#4F6420]">{status?.counts?.staged_count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
            <p className="text-[#4F6420]/70">Groups</p>
            <p className="font-semibold text-[#4F6420]">{status?.counts?.step_a_groups_count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-[#A7B580] bg-[#F9F9F5] p-3">
            <p className="text-[#4F6420]/70">Reduced Pool</p>
            <p className="font-semibold text-[#4F6420]">{status?.counts?.step_a_reduced_pool_count ?? 0}</p>
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 mb-6">
        <h2 className="text-lg font-semibold text-[#4F6420] mb-3">Artifacts</h2>
        {availablePaths.length === 0 ? (
          <p className="text-sm text-[#4F6420]/80">Artifacts are not ready yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-[#D5DCC0]">
                  <th className="py-2 pr-3">File</th>
                  <th className="py-2">Open</th>
                </tr>
              </thead>
              <tbody>
                {availablePaths.map((rel) => (
                  <tr key={rel} className="border-b border-[#E6EAD9]">
                    <td className="py-2 pr-3 break-all">{rel}</td>
                    <td className="py-2">
                      <a
                        className="text-[#4F6420] underline"
                        href={buildAssetUrl(base, albumId || "", rel)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open full file
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
