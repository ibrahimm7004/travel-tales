// Update-A, Update-G
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

type FreeTextCardProps = {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  // Update-G: optional label toggle
  showLabel?: boolean;
};

export default function FreeTextCard({ placeholder, value, onChange, showLabel = false }: FreeTextCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // Update-A: make card handle focus/hover
      className="card-default focus-within:ring-2 focus-within:ring-[#6B8E23]/30 hover:shadow-[0_4px_10px_rgba(107,142,35,0.20)] transition-all"
    >
      {showLabel && (
        // Update-G: small label inside card
        <div className="text-xs text-[#7A983F] mb-2" style={{ fontFamily: "Lato, sans-serif" }}>
          Other
        </div>
      )}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // Update-A: borderless, transparent input
        className="journal-input bg-transparent border-none focus:ring-0 focus:outline-none shadow-none"
        style={{ backgroundColor: "transparent" }}
      />
    </motion.div>
  );
}

