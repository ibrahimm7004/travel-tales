import { useMemo } from "react";
import { usePipelineProgress } from "@/state/pipelineProgress";

export default function PipelineProgressBar() {
  const { state } = usePipelineProgress();

  const progressRaw = useMemo(() => {
    const value = Number(state.progress || 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }, [state.progress]);
  const progressPercent = useMemo(() => Math.round(progressRaw * 100), [progressRaw]);
  const progressWidth = useMemo(() => `${(progressRaw * 100).toFixed(2)}%`, [progressRaw]);
  if (!state.visible || state.mode === "idle") return null;

  const color = state.mode === "error" ? "bg-red-600" : "bg-[#6B8E23]";
  const border = state.mode === "error" ? "border-red-200" : "border-[#A7B580]";
  const muted = state.mode === "error" ? "text-red-700/80" : "text-[#4F6420]/80";
  const title = state.mode === "error" ? "text-red-700" : "text-[#4F6420]";

  return (
    <div className="fixed top-0 left-0 right-0 z-[70] px-4 pt-3 pointer-events-none">
      <div className={`mx-auto max-w-5xl rounded-xl border ${border} bg-[#F9F9F5]/95 shadow-vintage backdrop-blur`}>
        <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-3">
          <p className={`text-xs font-semibold ${title}`}>{state.label}</p>
          <p className={`text-xs font-semibold ${title}`}>{progressPercent}%</p>
        </div>
        <div className="px-4 pb-2">
          <p className={`text-[11px] ${muted}`}>{state.detail}</p>
        </div>
        <div className="h-1.5 rounded-b-xl overflow-hidden bg-[#E6EAD9]">
          <div className={`${color} h-full transition-[width] duration-700 ease-linear`} style={{ width: progressWidth }} />
        </div>
      </div>
    </div>
  );
}
