import { motion } from "framer-motion";

type Props = { icon?: React.ReactNode; label: string; className?: string; testId?: string };

function cn(...args: Array<string | undefined | false>) {
  return args.filter(Boolean).join(" ");
}

export default function SelectedAnswerPill({ icon, label, className, testId }: Props) {
  return (
    <motion.span
      data-testid={testId}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5",
        "border border-[#6B8E23] bg-[#F9F9F5] text-[#4F6420] text-sm shadow-inner",
        "max-w-[60%] truncate",
        className
      )}
      title={label}
      aria-label={label}
    >
      {icon}
      <span className="truncate">{label}</span>
    </motion.span>
  );
}




