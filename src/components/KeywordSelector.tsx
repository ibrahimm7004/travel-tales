import { useMemo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type KeywordSelectorProps = {
  keywords: string[];
  selected: string[];
  onChange: (newSelected: string[]) => void;
  max?: number;
};

export default function KeywordSelector({ keywords, selected, onChange, max = 3 }: KeywordSelectorProps) {
  const [customValue, setCustomValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canAddMore = selected.length < max;
  const available = useMemo(() => keywords.filter(k => !selected.includes(k)), [keywords, selected]);

  const toggle = (k: string) => {
    if (selected.includes(k)) onChange(selected.filter(s => s !== k));
    else if (canAddMore) onChange([...selected, k]);
  };

  const normalize = (s: string) => s.trim().toLowerCase();
  const commitCustom = () => {
    const v = customValue.trim();
    if (!v) return;
    const exists = selected.map(normalize).includes(normalize(v));
    if (!exists && canAddMore) {
      onChange([...selected, v]);
    }
    setCustomValue("");
  };

  return (
    <div data-testid="q3-keywords" className="flex flex-wrap gap-2">
      <AnimatePresence>
        {selected.map((k) => (
          <motion.div
            key={`sel-${k}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative group"
          >
            <button
              type="button"
              onClick={() => toggle(k)}
              className="px-3 py-1.5 rounded-full bg-[#6B8E23] text-white text-sm pr-6"
              onKeyDown={(e) => {
                if (e.key === "Backspace" || e.key === "Delete") toggle(k);
              }}
            >
              {k}
            </button>
            <button
              aria-label={`Remove keyword ${k}`}
              onClick={() => toggle(k)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white/90 text-[#6B8E23] opacity-0 group-hover:opacity-100 transition-opacity shadow-sm flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {available.map((k) => (
          <motion.button
            key={`avail-${k}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            type="button"
            disabled={!canAddMore && !selected.includes(k)}
            onClick={() => toggle(k)}
            className="px-3 py-1.5 rounded-full border border-[#A7B580] bg-[#F9F9F5] text-[#4F6420] text-sm hover:bg-[#E8EBD1]"
          >
            {k}
          </motion.button>
        ))}
      </AnimatePresence>

      <input
        ref={inputRef}
        value={customValue}
        onChange={(e) => setCustomValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitCustom();
        }}
        placeholder="Add your own…"
        className="min-w-[240px] h-11 px-4 rounded-full border border-[#6B8E23] bg-[#F9F9F5] text-[#4F6420] text-[15px] placeholder:text-[#6B8E23]/70 focus:outline-none focus-visible:outline-none focus:shadow-[0_0_0_3px_rgba(107,142,35,0.25)]"
        style={{ backgroundColor: "#F9F9F5" }}
        aria-label="Add your own keyword"
      />
    </div>
  );
}


