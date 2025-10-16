import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type KeywordSelectorProps = {
  keywords: string[];
  selected: string[];
  onChange: (newSelected: string[]) => void;
  max?: number;
};

export default function KeywordSelector({ keywords, selected, onChange, max = 3 }: KeywordSelectorProps) {
  const [addingCustom, setAddingCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const canAddMore = selected.length < max;
  const available = useMemo(() => keywords.filter(k => !selected.includes(k)), [keywords, selected]);

  const toggle = (k: string) => {
    if (selected.includes(k)) onChange(selected.filter(s => s !== k));
    else if (canAddMore) onChange([...selected, k]);
  };

  const commitCustom = () => {
    const v = customValue.trim();
    if (!v) return;
    if (!selected.includes(v) && canAddMore) {
      onChange([...selected, v]);
    }
    setCustomValue("");
    setAddingCustom(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <AnimatePresence>
        {selected.map((k) => (
          <motion.div
            key={`sel-${k}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative"
          >
            <button
              type="button"
              onClick={() => toggle(k)}
              className="px-3 py-1.5 rounded-full bg-[#6B8E23] text-white text-sm pr-6"
            >
              {k}
            </button>
            <button
              aria-label="Remove"
              onClick={() => toggle(k)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white/90 text-[#6B8E23] opacity-0 hover:opacity-100 transition-opacity shadow-sm flex items-center justify-center"
            >
              <X size={10} />
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

      {addingCustom ? (
        <input
          autoFocus
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCustom();
            if (e.key === "Escape") { setAddingCustom(false); setCustomValue(""); }
          }}
          placeholder="Add your own…"
          className="min-w-[140px] journal-input bg-[#F9F9F5] border border-[#6B8E23] rounded-full px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#6B8E23]/30"
          style={{ backgroundColor: "#F9F9F5" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingCustom(true)}
          className="min-w-[140px] px-3 py-1.5 rounded-full border border-[#A7B580] bg-[#F9F9F5] text-[#4F6420] text-sm hover:bg-[#E8EBD1]"
        >
          Add your own…
        </button>
      )}
    </div>
  );
}


