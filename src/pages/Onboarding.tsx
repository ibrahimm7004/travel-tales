import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { SuggestionCard } from "@/components/SuggestionCard";
import PromptSection from "@/components/PromptSection";
import LocationAutocomplete from "@/components/LocationAutocomplete";
import TripDateSelector from "@/components/TripDateSelector";
import SelectedAnswerPill from "@/components/SelectedAnswerPill";
import KeywordSelector from "@/components/KeywordSelector";
import { specialTripKeywords } from "@/data/specialTripKeywords";
import { StepHighlights, HIGHLIGHT_OPTIONS } from "./onboarding/StepHighlights";
import { computePrefillWhere, computePrefillWhen, computePrefillKeywords, computePrefillHighlights } from "@/lib/onboarding/prefill";
import { useIntent } from "@/state/intentStore";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { MapPin, Calendar, Building, Mountain, Sunset } from "lucide-react";

interface OnboardingData {
  tripWheres: string[];
  tripWhen: string;
  specialKeywords: string[];
  highlights: string[];
}

const suggestions = {
  destinations: [
    { title: "Paris, France", subtitle: "City of Light", icon: <Building size={24} /> },
    { title: "Tokyo, Japan", subtitle: "Modern meets traditional", icon: <Building size={24} /> },
    { title: "Bali, Indonesia", subtitle: "Island paradise", icon: <Mountain size={24} /> },
    { title: "New York, USA", subtitle: "The Big Apple", icon: <Building size={24} /> },
  ],
  timeframes: [
    { title: "Summer 2025", subtitle: "June - August", icon: <Sunset size={24} /> },
    { title: "Autumn 2025", subtitle: "September - November", icon: <Calendar size={24} /> },
    { title: "Winter 2025", subtitle: "December - February", icon: <Calendar size={24} /> },
    { title: "Spring 2025", subtitle: "March - May", icon: <Calendar size={24} /> },
  ],
};

const DEFAULT_KEYWORDS = [...specialTripKeywords];
const KEYWORD_PREFILL = 3;
const KEYWORD_MIN = 3;
const KEYWORD_MAX = 10;
const HIGHLIGHT_CAP = 2;

const stepVariants = {
  initial: (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
  animate: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40 }),
} as const;

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    tripWheres: [],
    tripWhen: "",
    specialKeywords: [],
    highlights: [],
  });
  const [keywordOptions, setKeywordOptions] = useState<string[]>(DEFAULT_KEYWORDS);
  const [whereInput, setWhereInput] = useState("");
  const [isTripDateOpen, setIsTripDateOpen] = useState(false);
  const [touchedWhere, setTouchedWhere] = useState(false);
  const [touchedWhen, setTouchedWhen] = useState(false);
  const [touchedKeywords, setTouchedKeywords] = useState(false);
  const [touchedHighlights, setTouchedHighlights] = useState(false);
  const prefillGuardRef = useRef({ where: false, when: false, keywords: false, highlights: false });

  const navigate = useNavigate();
  const { intent } = useIntent();

  useEffect(() => {
    prefillGuardRef.current = { where: false, when: false, keywords: false, highlights: false };
    setKeywordOptions(DEFAULT_KEYWORDS);
  }, [intent]);

  const allowedHighlights = useMemo(() => HIGHLIGHT_OPTIONS.map((option) => option.key), []);
  const migratedHighlightKeys = useMemo(
    () => ({ destinations: "historyLandmarks", experiences: "cultureHeritage" } as Record<string, string>),
    []
  );
  const keywordCount = formData.specialKeywords.length;
  const keywordsInvalid = keywordCount < KEYWORD_MIN || keywordCount > KEYWORD_MAX;

  useEffect(() => {
    setFormData((prev) => {
      const migrated = prev.highlights.map((key) => migratedHighlightKeys[key] ?? key);
      const sanitized = migrated.filter((key) => allowedHighlights.includes(key));
      if (sanitized.length === prev.highlights.length && sanitized.every((key, index) => key === prev.highlights[index])) {
        return prev;
      }
      return { ...prev, highlights: sanitized };
    });
  }, [allowedHighlights, migratedHighlightKeys]);

  useEffect(() => {
    if (!intent || touchedWhere || prefillGuardRef.current.where) return;
    if (formData.tripWheres.length > 0) return;
    const suggested = computePrefillWhere(intent);
    if (suggested.length) {
      setFormData((prev) => ({ ...prev, tripWheres: suggested.slice(0, 6) }));
    }
    prefillGuardRef.current.where = true;
  }, [intent, touchedWhere, formData.tripWheres.length]);

  useEffect(() => {
    if (!intent || touchedWhen || prefillGuardRef.current.when) return;
    if (formData.tripWhen) return;
    const whenValue = computePrefillWhen(intent);
    if (whenValue) {
      setFormData((prev) => ({ ...prev, tripWhen: whenValue }));
    }
    prefillGuardRef.current.when = true;
  }, [intent, touchedWhen, formData.tripWhen]);

  useEffect(() => {
    if (!intent || touchedKeywords || prefillGuardRef.current.keywords) return;
    const { options, preselected } = computePrefillKeywords(intent, DEFAULT_KEYWORDS, KEYWORD_PREFILL);
    setKeywordOptions(options);
    if (!formData.specialKeywords.length && preselected.length) {
      setFormData((prev) => ({ ...prev, specialKeywords: preselected.slice(0, KEYWORD_PREFILL) }));
    }
    prefillGuardRef.current.keywords = true;
  }, [intent, touchedKeywords, formData.specialKeywords.length]);

  useEffect(() => {
    if (!intent || touchedHighlights || prefillGuardRef.current.highlights) return;
    if (formData.highlights.length) return;
    const selected = computePrefillHighlights(intent, HIGHLIGHT_CAP);
    if (selected.length) {
      setFormData((prev) => ({ ...prev, highlights: selected.slice(0, HIGHLIGHT_CAP) }));
    }
    prefillGuardRef.current.highlights = true;
  }, [intent, touchedHighlights, formData.highlights.length]);

  const handleNext = async () => {
    if (currentStep < totalSteps - 1) {
      setDirection(1);
      setCurrentStep((step) => step + 1);
    } else {
      await handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((step) => step - 1);
    } else {
      navigate("/home");
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const payload = {
        type: "onboarding-answers",
        trip_wheres: formData.tripWheres,
        trip_where: formData.tripWheres.join(" | "),
        trip_when: formData.tripWhen,
        special_keywords: formData.specialKeywords,
        highlights: formData.highlights,
      };

      fetch(`${base}/debug/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {
      // dev logging only
    } finally {
      setIsSubmitting(false);
      navigate("/results/step-a");
    }
  };

  const handleHighlightToggle = (key: string) => {
    setTouchedHighlights(true);
    setFormData((prev) => {
      if (prev.highlights.includes(key)) {
        return { ...prev, highlights: prev.highlights.filter((value) => value !== key) };
      }
      if (prev.highlights.length >= HIGHLIGHT_CAP) {
        return prev;
      }
      return { ...prev, highlights: [...prev.highlights, key] };
    });
  };

  const steps = [
    {
      id: "where",
      title: "Location",
      render: (
        <PromptSection>
          <div className="space-y-6 md:space-y-7">
            <div className="flex items-start gap-2 mb-4">
              <span className="inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
              <div>
                <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Where did you travel?</h3>
                <p className="mt-1 text-[12px] text-[#4F6420]/60">Select one or more destinations.</p>
              </div>
            </div>
            <div role="group" aria-label="Select one or more destinations" className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
              {suggestions.destinations.map((dest) => (
                <SuggestionCard
                  key={dest.title}
                  title={dest.title}
                  subtitle={dest.subtitle}
                  icon={dest.icon}
                  isSelected={formData.tripWheres.includes(dest.title)}
                  onClick={() => {
                    setTouchedWhere(true);
                    setFormData((prev) => ({
                      ...prev,
                      tripWheres: prev.tripWheres.includes(dest.title)
                        ? prev.tripWheres.filter((d) => d !== dest.title)
                        : prev.tripWheres.concat(dest.title),
                    }));
                  }}
                />
              ))}
            </div>
            <LocationAutocomplete
              value={whereInput}
              onChange={(value) => {
                setWhereInput(value);
              }}
              onCommit={(value) => {
                const trimmed = (value || "").trim();
                if (!trimmed) return;
                setTouchedWhere(true);
                setFormData((prev) => ({
                  ...prev,
                  tripWheres: prev.tripWheres.includes(trimmed) ? prev.tripWheres : prev.tripWheres.concat(trimmed),
                }));
                setWhereInput("");
              }}
              placeholder="Or type your own destination..."
              className="!p-3"
            />
            {formData.tripWheres.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="q1-selected-list">
                {formData.tripWheres.map((loc) => (
                  <SelectedAnswerPill
                    key={loc}
                    icon={<MapPin size={16} className="shrink-0" />}
                    label={loc}
                    maxWidthClass="max-w-[180px]"
                    onRemove={() => {
                      setTouchedWhere(true);
                      setFormData((prev) => ({
                        ...prev,
                        tripWheres: prev.tripWheres.filter((x) => x !== loc),
                      }));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </PromptSection>
      ),
    },
    {
      id: "when",
      title: "Dates",
      render: (
        <PromptSection>
          <div className="space-y-6 md:space-y-7">
            <div className="flex items-start gap-2 mb-4">
              <span className="inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
              <div>
                <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>When was your trip?</h3>
                <p className="mt-1 text-[12px] text-[#4F6420]/60">Select a timeframe or pick a custom date.</p>
              </div>
            </div>
            <div role="radiogroup" aria-label="Select an option" className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
              {suggestions.timeframes.map((time) => (
                <SuggestionCard
                  key={time.title}
                  title={time.title}
                  subtitle={time.subtitle}
                  icon={time.icon}
                  isSelected={formData.tripWhen === time.title}
                  onClick={() => {
                    setTouchedWhen(true);
                    setFormData((prev) => ({ ...prev, tripWhen: time.title }));
                  }}
                />
              ))}
              <div className="md:col-span-2">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setIsTripDateOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setIsTripDateOpen(true);
                    }
                  }}
                  className="card-default focus-within:ring-2 focus-within:ring-[#6B8E23]/30 hover:shadow-[0_4px_10px_rgba(107,142,35,0.20)] transition-all !p-3"
                >
                  <div className="flex items-center gap-2.5">
                    <Calendar size={18} className="text-[#6B8E23]" />
                    <input
                      readOnly
                      value=""
                      placeholder="Or pick a custom date..."
                      className="journal-input bg-transparent border-none focus:ring-0 focus:outline-none shadow-none flex-1 py-1.5 placeholder:italic"
                      style={{ backgroundColor: "transparent" }}
                      onFocus={() => setIsTripDateOpen(true)}
                      aria-label="Pick a custom date"
                    />
                  </div>
                </div>
              </div>
            </div>
            <TripDateSelector
              isOpen={isTripDateOpen}
              onClose={() => setIsTripDateOpen(false)}
              onSelect={(label) => {
                setTouchedWhen(true);
                setFormData((prev) => ({ ...prev, tripWhen: label }));
              }}
            />
            {formData.tripWhen && (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="q2-selected-list">
                <SelectedAnswerPill
                  key={formData.tripWhen}
                  icon={<Calendar size={16} className="shrink-0" />}
                  label={formData.tripWhen}
                  maxWidthClass="max-w-[180px]"
                  onRemove={() => {
                    setTouchedWhen(true);
                    setFormData((prev) => ({ ...prev, tripWhen: "" }));
                  }}
                  tabIndex={0}
                />
              </div>
            )}
          </div>
        </PromptSection>
      ),
    },
    {
      id: "what",
      title: "Key Memories",
      render: (
        <PromptSection>
          <div className="space-y-6 md:space-y-7">
            <div data-testid="q3-heading-block" className="flex items-start gap-2 mb-2">
              <span className="inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
              <div>
                <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
                  What made this trip special?
                </h3>
                <p className={`mt-1 text-[12px] ${keywordsInvalid ? "text-[#B35C4B]" : "text-[#4F6420]/60"}`}>
                  Pick 3–10 keywords that define your trip.
                </p>
              </div>
            </div>
            <KeywordSelector
              keywords={keywordOptions}
              selected={formData.specialKeywords}
              onChange={(arr) => {
                setTouchedKeywords(true);
                const limited = arr.slice(0, KEYWORD_MAX);
                setFormData((prev) => ({ ...prev, specialKeywords: limited }));
              }}
              max={KEYWORD_MAX}
            />
            <p className={`text-[12px] mt-1 ${keywordsInvalid ? "text-[#B35C4B]" : "text-[#4F6420]/60"}`}>
              {`${keywordCount}/${KEYWORD_MAX} selected`}
            </p>
          </div>
        </PromptSection>
      ),
    },
    {
      id: "highlights",
      title: "Trip Highlights",
      render: (
        <StepHighlights selected={formData.highlights} onToggle={handleHighlightToggle} />
      ),
    },
  ];

  const totalSteps = steps.length;

  const isStepValid = useMemo(() => {
    switch (currentStep) {
      case 0:
        return formData.tripWheres.length > 0;
      case 1:
        return Boolean(formData.tripWhen);
      case 2:
        return keywordCount >= KEYWORD_MIN && keywordCount <= KEYWORD_MAX;
      case 3:
        return formData.highlights.length > 0;
      default:
        return false;
    }
  }, [currentStep, formData.tripWheres.length, formData.tripWhen, formData.specialKeywords.length, formData.highlights.length]);

  return (
    <div className="min-h-screen vintage-bg flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} className="mb-12" />
        <div className="relative bg-card/90 rounded-2xl shadow-vintage p-8 md:p-12 border border-border backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="absolute top-6 left-6 w-11 h-11 bg-[#F9F9F5] border border-[#A7B580]/80 text-[#6B8E23] rounded-full shadow-[0_2px_6px_rgba(107,142,35,0.25)] hover:bg-[#E8EBD1] hover:shadow-[0_3px_8px_rgba(107,142,35,0.35)] transition-all duration-200 flex items-center justify-center"
          >
            <ArrowLeft size={22} strokeWidth={2} />
          </Button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={steps[currentStep].id}
              variants={stepVariants}
              custom={direction}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.28 }}
              className="space-y-8"
            >
              <div className="text-center">
                <h2
                  className="text-3xl font-serif font-semibold mb-3 tracking-wide"
                  style={{ fontFamily: "Supernova, serif", color: "#4F6420" }}
                >
                  {steps[currentStep].title}
                </h2>
              </div>
              {steps[currentStep].render}
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-end items-center mt-12 pt-8 border-t border-border">
            <button
              type="button"
              onClick={handleNext}
              disabled={!isStepValid || isSubmitting}
              className="cta-button"
            >
              {isSubmitting ? "Saving..." : currentStep === totalSteps - 1 ? "Complete Journey" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
