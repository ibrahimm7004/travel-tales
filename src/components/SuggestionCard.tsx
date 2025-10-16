import { motion } from "framer-motion";
import { Check } from "lucide-react";

interface SuggestionCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  isSelected?: boolean;
  onClick: () => void;
  isLoading?: boolean;
}

export function SuggestionCard({
  title,
  subtitle,
  icon,
  isSelected = false,
  onClick,
  isLoading = false,
}: SuggestionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      role="radio"
      aria-checked={isSelected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
          return;
        }
        const current = e.currentTarget as HTMLElement;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = current.nextElementSibling as HTMLElement | null;
          next?.focus();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prev = current.previousElementSibling as HTMLElement | null;
          prev?.focus();
        }
      }}
      // Update-B: stronger selected/focus ring
      className={`card-default ${isSelected ? "card-selected ring-2 ring-[#6B8E23]/30" : ""} ${isLoading ? "pointer-events-none opacity-60" : ""} focus:outline-none focus:ring-2 focus:ring-[#6B8E23]/40`}
      onMouseEnter={(e) => (e.currentTarget.classList.add("card-hover"))}
      onMouseLeave={(e) => (e.currentTarget.classList.remove("card-hover"))}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Update-B: normalize icon column width */}
          {icon && <div className="icon text-[#6B8E23] w-6 flex justify-center">{icon}</div>}

          <div className="text-left">
            {/* Main title should use Lato per font hierarchy */}
            <h3
              className="text-lg font-semibold text-[#4F6420] mb-1"
              style={{ fontFamily: "Lato, sans-serif" }}
            >
              {title}
            </h3>

            {/* Subtitle uses Lato for softer secondary info */}
            {subtitle && (
              <p
                className="text-sm text-[#6B8E23]"
                style={{ fontFamily: "'Lato', sans-serif" }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {isSelected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-[#6B8E23]"
          >
            <Check size={20} />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
