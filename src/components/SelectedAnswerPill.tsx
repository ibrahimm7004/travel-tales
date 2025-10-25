import { motion } from "framer-motion";

type Props = {
  icon?: React.ReactNode;
  label: string;
  className?: string;
  testId?: string;
  maxWidthClass?: string; // e.g., "max-w-[180px]"
  onRemove?: () => void; // optional trailing remove action
  removeAriaLabel?: string;
  tabIndex?: number;
};

function cn(...args: Array<string | undefined | false>) {
  return args.filter(Boolean).join(" ");
}

export default function SelectedAnswerPill({ icon, label, className, testId, maxWidthClass = "max-w-[180px]", onRemove, removeAriaLabel, tabIndex }: Props) {
  return (
    <motion.span
      data-testid={testId}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      tabIndex={typeof tabIndex === "number" ? tabIndex : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5",
        "border border-[#6B8E23] bg-[#F9F9F5] text-[#4F6420] text-sm shadow-inner",
        "hover:bg-[#E8EBD1] transition-colors",
        className
      )}
      title={label}
      aria-label={label}
    >
      {icon}
      <span className={cn("truncate", "min-w-0", "flex-1", maxWidthClass)}>{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeAriaLabel || `Remove ${label}`}
          onClick={onRemove}
          className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#6B8E23] text-white hover:bg-[#5C7C1A] focus:outline-none focus:ring-2 focus:ring-[#6B8E23]/40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M6.225 4.811a.75.75 0 011.06 0L12 9.525l4.715-4.714a.75.75 0 111.06 1.06L13.06 10.586l4.715 4.714a.75.75 0 11-1.06 1.061L12 11.647l-4.715 4.714a.75.75 0 01-1.06-1.06l4.714-4.715-4.714-4.715a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        </button>
      ) : null}
    </motion.span>
  );
}




