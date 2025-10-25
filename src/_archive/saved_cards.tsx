import * as React from "react";
import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const ARCHIVED_EXAMPLES = [
  "I visited Italy this summer for my honeymoon with my fiancé — curate the most romantic photos.",
  "Family trip to NYC with the kids — extract our best shots at famous spots.",
  "Backpacking across Japan — highlight street food, temples, and night alleys.",
  "Safari in Kenya — pick the sharpest wildlife moments and golden-hour shots.",
  "Beach week in Bali — keep sunsets, waves, and the most serene frames."
];

const MAX_PREVIEW_WORDS = 30;

function getPreviewText(text: string, maxWords: number) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + " ...";
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function SavedCardsArchive() {
  const [examples, setExamples] = React.useState<string[]>(ARCHIVED_EXAMPLES);
  const [selected, setSelected] = React.useState<string | null>(null);

  const onRegenerate = () => {
    setExamples((prev) => shuffle(prev));
  };

  return (
    <section aria-label="Archived examples grid">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <div className="cards-wrapper mt-8 md:mt-10 max-w-3xl mx-auto rounded-xl border border-border bg-[#B7BC84] text-[#456409] shadow-soft p-3 md:p-4">
          <div className="space-y-2">
            <Card className="border-border bg-card shadow-soft hover:shadow-vintage transition-all duration-200">
              <CardContent className="px-4 py-2.5 md:px-5 md:py-3 min-h-14 flex items-center justify-between gap-3">
                <h3 className="font-sans text-sm md:text-base font-bold text-[#456409]">
                  Or try one of these examples:
                </h3>
                <button
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-transparent rounded-lg bg-primary text-white hover:bg-primary/90 transition-all duration-200 font-bold"
                  title="Regenerate suggestions"
                >
                  <RotateCcw size={16} strokeWidth={3} />
                  <span>REGENERATE</span>
                </button>
              </CardContent>
            </Card>

            <div className="suggestion-row grid grid-cols-1 md:grid-cols-2 gap-3">
              {examples.map((suggestion, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                >
                  <Card
                    onClick={() => setSelected(suggestion)}
                    className={`group cursor-pointer transition-all duration-300 transform-gpu shadow-soft hover:shadow-vintage hover:-translate-y-1 hover:scale-[1.02] hover:border-primary/40 hover:bg-primary/5 ${
                      selected === suggestion ? "border-primary bg-primary/10" : "border-border bg-card"
                    }`}
                  >
                    <CardContent className="p-4 md:p-5 relative overflow-hidden h-36 flex items-center">
                      <div
                        className="absolute top-0 -left-full w-full h-full opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:left-full"
                        style={{
                          background: "linear-gradient(90deg, transparent, hsl(var(--primary) / 0.1), transparent)"
                        }}
                      />

                      <p className="text-[#456409] text-sm leading-snug relative z-10">
                        {getPreviewText(suggestion, MAX_PREVIEW_WORDS)}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}


