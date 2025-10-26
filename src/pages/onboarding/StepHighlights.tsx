import { ReactNode } from "react";
import PromptSection from "@/components/PromptSection";
import { SuggestionCard } from "@/components/SuggestionCard";
import {
  Mountain,
  Utensils,
  Building,
  Camera,
  Users,
  RefreshCw,
  Navigation,
  Sparkles,
  Landmark,
  Palette,
} from "lucide-react";

type HighlightOption = {
  key: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
};

export const HIGHLIGHT_OPTIONS: HighlightOption[] = [
  {
    key: "natureLandscapes",
    title: "Nature & Landscapes",
    subtitle: "Mountains, beaches, sunsets",
    icon: <Mountain size={24} />,
  },
  {
    key: "foodDining",
    title: "Food & Dining",
    subtitle: "Local cuisine and restaurants",
    icon: <Utensils size={24} />,
  },
  {
    key: "architecture",
    title: "Architecture",
    subtitle: "Buildings and structures",
    icon: <Building size={24} />,
  },
  {
    key: "streetPhotography",
    title: "Street Photography",
    subtitle: "Urban life and culture",
    icon: <Camera size={24} />,
  },
  {
    key: "groupPeople",
    title: "Group & People",
    subtitle: "Friends and family moments",
    icon: <Users size={24} />,
  },
  {
    key: "adventureActivities",
    title: "Adventure & Activities",
    subtitle: "Sports and experiences",
    icon: <RefreshCw size={24} />,
  },
  {
    key: "journey",
    title: "The Journey",
    subtitle: "Travel experiences and transit",
    icon: <Navigation size={24} />,
  },
  {
    key: "cultureHeritage",
    title: "Culture & Heritage",
    subtitle: "Festivals and traditions",
    icon: <Sparkles size={24} />,
  },
  {
    key: "museumsArt",
    title: "Museums & Art",
    subtitle: "Galleries and exhibits",
    icon: <Palette size={24} />,
  },
  {
    key: "historyLandmarks",
    title: "History & Landmarks",
    subtitle: "Monuments and UNESCO sites",
    icon: <Landmark size={24} />,
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
              Things you want to Emphasize
            </h3>
            <p className="mt-1 text-[12px] text-[#4F6420]/60">
              Pick the themes you want to spotlight. We'll emphasize these in your photobook.
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
