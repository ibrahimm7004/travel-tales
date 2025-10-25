import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type InstructionsBarProps = {
  state: "current" | "done";
  label: string;
  detail?: string;
  className?: string;
};

export function InstructionsBar({ state, label, detail, className }: InstructionsBarProps) {
  const isDone = state === "done";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {isDone && <Check className="h-4 w-4 text-[#5B7A1E]" aria-hidden="true" />}
      <span
        className={cn(
          "uppercase tracking-wide text-[13px]",
          isDone ? "text-gray-500" : "text-gray-700"
        )}
      >
        {label}
      </span>
      {detail && (
        <span
          className={cn(
            "text-sm",
            isDone ? "text-gray-500 font-medium" : "text-gray-700 font-semibold"
          )}
        >
          {detail}
        </span>
      )}
    </div>
  );
}


