import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildDemoAssetUrl, resolveAlbumIdFromQueryOrSession, withAlbumId } from "@/pages/results/demoHelpers";
import { ResultsLayout } from "@/pages/results/ResultsLayout";

type StepCMatch = {
  ts: string;
  left_cluster_id: number;
  right_cluster_id: number;
  winner_cluster_id: number;
};

type StepCCluster = {
  cluster_id: number;
  cluster_name: string;
  size: number;
  representatives: string[];
  elo: number;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
  momentum: string;
  ratio: number;
  keep_count: number;
};

type StepCState = {
  albumId: string;
  max_matches: number;
  max_warmup_matches: number;
  total_images: number;
  total_matches: number;
  top3_streak: number;
  done: boolean;
  stop_reason?: string | null;
  matches: StepCMatch[];
  clusters: StepCCluster[];
};

type Matchup = {
  leftId: number;
  rightId: number;
  reason: string;
};

const TOP_POOL = 8;

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clusterSort(a: StepCCluster, b: StepCCluster): number {
  return toNum(a.cluster_id) - toNum(b.cluster_id);
}

function eloSort(a: StepCCluster, b: StepCCluster): number {
  const ea = toNum(a.elo);
  const eb = toNum(b.elo);
  if (ea !== eb) return eb - ea;
  return clusterSort(a, b);
}

function pickNextMatch(state: StepCState): Matchup | null {
  const clusters = [...(state.clusters || [])].sort(clusterSort);
  if (state.done || clusters.length < 2) return null;

  const totalMatches = toNum(state.total_matches, (state.matches || []).length);
  const warmupCap = Math.max(1, toNum(state.max_warmup_matches, 6));
  const unseen = clusters.filter((c) => toNum(c.games) <= 0);

  if (unseen.length > 0 && totalMatches < warmupCap) {
    const focus = unseen[0];
    const played = clusters
      .filter((c) => toNum(c.cluster_id) !== toNum(focus.cluster_id) && toNum(c.games) > 0)
      .sort(eloSort);
    const baseline = played[0]
      || clusters
        .filter((c) => toNum(c.cluster_id) !== toNum(focus.cluster_id))
        .sort((a, b) => {
          const sizeCmp = toNum(b.size) - toNum(a.size);
          if (sizeCmp !== 0) return sizeCmp;
          return clusterSort(a, b);
        })[0];
    if (!baseline) return null;
    return { leftId: toNum(focus.cluster_id), rightId: toNum(baseline.cluster_id), reason: "Warm-up coverage" };
  }

  const topElo = [...clusters].sort(eloSort).slice(0, TOP_POOL).map((c) => toNum(c.cluster_id));
  const topSet = new Set<number>(topElo);
  const candidates = clusters.filter((c) => topSet.has(toNum(c.cluster_id)) || toNum(c.games) < 2);
  const pool = candidates.length >= 2 ? candidates : clusters;

  let best: Matchup | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i];
      const b = pool[j];
      const idA = Math.min(toNum(a.cluster_id), toNum(b.cluster_id));
      const idB = Math.max(toNum(a.cluster_id), toNum(b.cluster_id));
      const score = -Math.abs(toNum(a.elo) - toNum(b.elo)) + (15 / (1 + toNum(a.games) + toNum(b.games)));
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = { leftId: idA, rightId: idB, reason: "Refinement (uncertainty sampling)" };
        continue;
      }
      if (Math.abs(score - bestScore) <= 1e-9 && best) {
        if (idA < best.leftId || (idA === best.leftId && idB < best.rightId)) {
          best = { leftId: idA, rightId: idB, reason: "Refinement (uncertainty sampling)" };
        }
      }
    }
  }
  return best;
}

type ContestTileProps = {
  base: string;
  albumId: string;
  cluster: StepCCluster;
  activeWinnerId: number | null;
  leftId: number;
  rightId: number;
  disabled: boolean;
  onPick: (winnerClusterId: number) => void;
};

function ContestTile({
  base,
  albumId,
  cluster,
  activeWinnerId,
  leftId,
  rightId,
  disabled,
  onPick,
}: ContestTileProps) {
  const cid = toNum(cluster.cluster_id);
  const hasChoice = activeWinnerId !== null;
  const isWinner = hasChoice && activeWinnerId === cid;
  const isLoser = hasChoice && activeWinnerId !== cid && (cid === leftId || cid === rightId);
  const reps = Array.isArray(cluster.representatives) ? cluster.representatives.slice(0, 4) : [];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(cid)}
      className={[
        "group relative w-full overflow-hidden rounded-2xl border bg-[#F9F9F5] text-left transition-all duration-300",
        "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#6B8E23]/15",
        "border-[#A7B580]",
        isWinner ? "ring-2 ring-emerald-500 scale-[1.01]" : "",
        isLoser ? "opacity-60 saturate-50" : "",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <div className="grid grid-cols-2 gap-1 p-1 bg-[#EBEEDB]">
        {Array.from({ length: 4 }).map((_, idx) => {
          const rel = reps[idx];
          return rel ? (
            <img
              key={`${cid}-${idx}-${rel}`}
              src={buildDemoAssetUrl(base, albumId, rel)}
              alt={`${cluster.cluster_name} top ${idx + 1}`}
              loading="lazy"
              decoding="async"
              className="h-28 w-full rounded-sm object-cover md:h-32"
            />
          ) : (
            <div
              key={`${cid}-${idx}-empty`}
              className="h-28 w-full rounded-sm border border-dashed border-[#A7B580] bg-white/60 md:h-32"
            />
          );
        })}
      </div>
      <div className="px-4 py-3">
        <p className="text-lg font-semibold text-[#4F6420] truncate">{cluster.cluster_name}</p>
        <p className="text-xs text-[#4F6420]/80">Cluster {cid} | Size {toNum(cluster.size)} | Top picks</p>
      </div>
      {isWinner ? <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(132,204,22,0.24),transparent_60%)]" /> : null}
    </button>
  );
}

export default function StepCContests() {
  const location = useLocation();
  const navigate = useNavigate();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [state, setState] = useState<StepCState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeWinnerId, setActiveWinnerId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = resolveAlbumIdFromQueryOrSession(location.search);
    if (!id) {
      setError("Could not resolve albumId for Step C.");
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
        const res = await fetch(`${base}/processing/post-upload/step-c/state?albumId=${encodeURIComponent(albumId)}`);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || "Failed to load Step C state.");
        }
        const data = (await res.json()) as StepCState;
        if (cancelled) return;
        setState(data);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Failed to load Step C state.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [albumId, base]);

  const clusterById = useMemo(() => {
    const m = new Map<number, StepCCluster>();
    for (const c of state?.clusters || []) {
      m.set(toNum(c.cluster_id), c);
    }
    return m;
  }, [state?.clusters]);

  const matchup = useMemo(() => (state ? pickNextMatch(state) : null), [state]);
  const leftCluster = matchup ? clusterById.get(matchup.leftId) || null : null;
  const rightCluster = matchup ? clusterById.get(matchup.rightId) || null : null;

  const matchNum = Math.min((toNum(state?.total_matches) + 1), Math.max(1, toNum(state?.max_matches, 12)));
  const matchesRemaining = Math.max(0, toNum(state?.max_matches, 12) - toNum(state?.total_matches));
  const progress = Math.max(0, Math.min(1, toNum(state?.total_matches) / Math.max(1, toNum(state?.max_matches, 12))));
  const topClusters = [...(state?.clusters || [])].sort(eloSort).slice(0, 8);

  const onPickWinner = async (winnerClusterId: number) => {
    if (!state || !matchup || !albumId || !base) return;
    if (submitting || state.done) return;
    setActiveWinnerId(winnerClusterId);
    setSubmitting(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 240));
      const res = await fetch(`${base}/processing/post-upload/step-c/choose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          albumId,
          left_cluster_id: matchup.leftId,
          right_cluster_id: matchup.rightId,
          winner_cluster_id: winnerClusterId,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Failed to save contest choice.");
      }
      const data = (await res.json()) as StepCState;
      setState(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to record contest choice.");
    } finally {
      window.setTimeout(() => {
        setActiveWinnerId(null);
      }, 160);
      setSubmitting(false);
    }
  };

  return (
    <ResultsLayout testId="step-c-contests-page" title="Category Contests" albumId={albumId}>
      {loading ? (
        <div className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 text-[#4F6420]">Loading Step C...</div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
      ) : null}

      {state && !loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-5">
          <section className={`rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4 transition-all duration-300 ${submitting ? "opacity-80 scale-[0.995]" : "opacity-100"}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#4F6420]">
                  Match {Math.max(1, matchNum)} / {Math.max(1, toNum(state.max_matches, 12))}
                </p>
                <p className="text-xs text-[#4F6420]/80">
                  {state.done ? (state.stop_reason || "Contests complete.") : (matchup?.reason || "Choosing next matchup...")}
                </p>
              </div>
              <p className="text-xs text-[#4F6420]/70">{matchesRemaining} remaining</p>
            </div>

            {!state.done && leftCluster && rightCluster ? (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 items-center">
                <ContestTile
                  base={base}
                  albumId={albumId || ""}
                  cluster={leftCluster}
                  activeWinnerId={activeWinnerId}
                  leftId={leftCluster.cluster_id}
                  rightId={rightCluster.cluster_id}
                  disabled={submitting}
                  onPick={onPickWinner}
                />
                <div className="hidden lg:flex items-center justify-center">
                  <div className="h-12 w-12 rounded-full border border-[#A7B580] bg-white text-[#4F6420] text-sm font-semibold flex items-center justify-center">
                    VS
                  </div>
                </div>
                <ContestTile
                  base={base}
                  albumId={albumId || ""}
                  cluster={rightCluster}
                  activeWinnerId={activeWinnerId}
                  leftId={leftCluster.cluster_id}
                  rightId={rightCluster.cluster_id}
                  disabled={submitting}
                  onPick={onPickWinner}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-[#A7B580] bg-white p-5 text-[#4F6420]">
                <p className="font-semibold">Preferences stabilized</p>
                <p className="text-sm text-[#4F6420]/80 mt-1">{state.stop_reason || "No further contests required."}</p>
              </div>
            )}

            <div className="mt-4">
              <div className="h-2 rounded-full overflow-hidden bg-[#E6EAD9]">
                <div className="h-full bg-[#6B8E23] transition-[width] duration-500 ease-linear" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
              </div>
            </div>
          </section>

          <aside className="rounded-xl border border-[#A7B580] bg-[#F9F9F5] p-4">
            <h2 className="text-base font-semibold text-[#4F6420] mb-3">Signals</h2>
            {leftCluster && rightCluster && !state.done ? (
              <div className="mb-4 rounded-lg border border-[#A7B580] bg-white p-3 text-xs text-[#4F6420] space-y-1">
                <p>Current pair: {leftCluster.cluster_id} vs {rightCluster.cluster_id}</p>
                <p>Elo gap: {Math.abs(toNum(leftCluster.elo) - toNum(rightCluster.elo)).toFixed(1)}</p>
                <p>Games: {toNum(leftCluster.games)} + {toNum(rightCluster.games)}</p>
              </div>
            ) : null}

            <div className="max-h-[420px] overflow-auto rounded-lg border border-[#A7B580] bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#EEF1DE] text-[#4F6420]">
                  <tr>
                    <th className="text-left px-2 py-2">Cluster</th>
                    <th className="text-right px-2 py-2">Elo</th>
                    <th className="text-right px-2 py-2">W-L</th>
                    <th className="text-right px-2 py-2">Ratio</th>
                    <th className="text-right px-2 py-2">Keep</th>
                  </tr>
                </thead>
                <tbody>
                  {topClusters.map((c) => (
                    <tr key={c.cluster_id} className="border-t border-[#EDF0E3] text-[#4F6420]">
                      <td className="px-2 py-2">
                        <div className="font-medium truncate max-w-[140px]">{c.cluster_name || `Cluster ${c.cluster_id}`}</div>
                        <div className="text-[11px] text-[#4F6420]/65">#{c.cluster_id} | g:{toNum(c.games)}</div>
                      </td>
                      <td className="px-2 py-2 text-right">{toNum(c.elo).toFixed(1)}</td>
                      <td className="px-2 py-2 text-right">{toNum(c.wins)}-{toNum(c.losses)}</td>
                      <td className="px-2 py-2 text-right">{(toNum(c.ratio) * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2 text-right">{toNum(c.keep_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={() => navigate(withAlbumId("/results/step-b", albumId))}
          className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]"
        >
          Back to Step B
        </button>
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

