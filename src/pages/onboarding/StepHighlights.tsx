import { ReactNode } from "react";
import PromptSection from "@/components/PromptSection";
import { SuggestionCard } from "@/components/SuggestionCard";
import {
  Gem,
  Sparkles,
  Palette,
  UserRound,
} from "lucide-react";

type HighlightOption = {
  key: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
};

export const HIGHLIGHT_OPTIONS: HighlightOption[] = [
  {
    key: "Classic & Timeless",
    title: "Classic & Timeless",
    subtitle: "Refined, enduring travel memories",
    icon: <Gem size={24} />,
  },
  {
    key: "Lively & Spontaneous",
    title: "Lively & Spontaneous",
    subtitle: "Energetic, candid moments in motion",
    icon: <Sparkles size={24} />,
  },
  {
    key: "Artistic Eye",
    title: "Artistic Eye",
    subtitle: "Creative framing and visual storytelling",
    icon: <Palette size={24} />,
  },
  {
    key: "Elegant Portrait",
    title: "Elegant Portrait",
    subtitle: "Polished people-first hero shots",
    icon: <UserRound size={24} />,
  },
];

type StepHighlightsProps = {
  selected: string[];
  onToggle: (key: string) => void;
  isLoading?: boolean;
};

export function StepHighlights({ selected, onToggle, isLoading = false }: StepHighlightsProps) {
  return (
    <PromptSection>
      <div className="space-y-6 md:space-y-7">
        <div className="flex items-start gap-2 mb-2">
          <span className="inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
          <div>
            <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
              Choose your mood
            </h3>
            <p className="mt-1 text-[12px] text-[#4F6420]/60">
              Pick up to 2 moods to guide your visual ranking.
            </p>
          </div>
        </div>
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6"
          role="group"
          aria-label="Select the highlights you want to keep in your photobook"
        >
          {HIGHLIGHT_OPTIONS.map((option) => (
            <SuggestionCard
              key={option.key}
              title={option.title}
              subtitle={option.subtitle}
              icon={option.icon}
              isSelected={selected.includes(option.key)}
              onClick={() => onToggle(option.key)}
              isLoading={isLoading}
            />
          ))}
        </div>
      </div>
    </PromptSection>
  );
}
