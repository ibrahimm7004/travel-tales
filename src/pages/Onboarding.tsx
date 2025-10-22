import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
// removed unused Input import
import { Textarea } from "@/components/ui/textarea";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { SuggestionCard } from "@/components/SuggestionCard";
import { CustomInput } from "@/components/CustomInput";
import PromptSection from "@/components/PromptSection";
import LocationAutocomplete from "@/components/LocationAutocomplete";
import TripDateSelector from "@/components/TripDateSelector";
import SelectedAnswerPill from "@/components/SelectedAnswerPill";
import KeywordSelector from "@/components/KeywordSelector";
import { specialTripKeywords } from "@/data/specialTripKeywords";
import { useNavigate } from "react-router-dom";
// DB writes disabled for upload flow; routing only
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, X } from "lucide-react";
import {
  MapPin,
  Calendar,
  Camera,
  Palette,
  Heart,
  Users,
  Mountain,
  RefreshCw,
  Utensils,
  Building,
  Camera as CameraIcon,
  Sunset,
} from "lucide-react";

const ENABLE_PROMPT_UI = true;

interface OnboardingData {
  tripWheres: string[];
  tripWhen: string;
  tripWhat: string;
  photoTypes: string[];
  personalization1: string;
  personalization2: string;
  specialKeywords: string[];
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
  photoTypes: [
    { title: "Nature & Landscapes", subtitle: "Mountains, beaches, sunsets", icon: <Mountain size={24} /> },
    { title: "Food & Dining", subtitle: "Local cuisine and restaurants", icon: <Utensils size={24} /> },
    { title: "Group Photos", subtitle: "Friends and family moments", icon: <Users size={24} /> },
    { title: "Architecture", subtitle: "Buildings and structures", icon: <Building size={24} /> },
    { title: "Street Photography", subtitle: "Urban life and culture", icon: <CameraIcon size={24} /> },
    { title: "Adventure & Activities", subtitle: "Sports and experiences", icon: <Heart size={24} /> },
  ],
  stylePreferences: [
    { title: "Classic & Timeless", subtitle: "Traditional storytelling", icon: <Camera size={24} /> },
    { title: "Modern & Vibrant", subtitle: "Bold and contemporary", icon: <Palette size={24} /> },
    { title: "Artistic & Creative", subtitle: "Unique perspectives", icon: <Palette size={24} /> },
    { title: "Documentary Style", subtitle: "Authentic moments", icon: <Camera size={24} /> },
  ],
  finalFocus: [
    { title: "The Journey", subtitle: "Travel experiences", icon: <MapPin size={24} /> },
    { title: "The Destinations", subtitle: "Places visited", icon: <Mountain size={24} /> },
    { title: "The People", subtitle: "Connections made", icon: <Users size={24} /> },
    { title: "The Experiences", subtitle: "Memories created", icon: <Heart size={24} /> },
  ],
};

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    tripWheres: [],
    tripWhen: "",
    tripWhat: "",
    photoTypes: [],
    personalization1: "",
    personalization2: "",
    specialKeywords: [],
  });
  const [whereInput, setWhereInput] = useState("");

  const navigate = useNavigate();
  const { toast } = useToast();

  const handleNext = async () => {
    if (currentStep < totalSteps - 1) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    } else {
      await handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    } else navigate("/home");
  };

  const handleSubmit = async () => {
    // Minimal backend persistence (no schema change): log answers for later processing
    try {
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const payload = {
        type: "onboarding-answers",
        trip_wheres: formData.tripWheres,
        trip_where: formData.tripWheres.join(" | "),
        trip_when: formData.tripWhen,
        trip_what: formData.tripWhat,
        photo_types: formData.photoTypes,
        personalization_q1: formData.personalization1,
        personalization_q2: formData.personalization2,
      };
      fetch(`${base}/debug/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
    navigate("/upload");
  };

  const handlePhotoTypeToggle = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      photoTypes: prev.photoTypes.includes(type)
        ? prev.photoTypes.filter((t) => t !== type)
        : [...prev.photoTypes, type],
    }));
  };

  const handleRegenerateSuggestions = async () => {
    setIsRegenerating(true);
    setTimeout(() => {
      setIsRegenerating(false);
      toast({
        title: "Feature coming soon!",
        description: "AI-powered suggestions will be available in the next update.",
      });
    }, 1500);
  };

  const [isTripDateOpen, setIsTripDateOpen] = useState(false);
  
  // Defensive sanitize of Step 2 selections to predefined allow-lists
  const allowedPhotoTypes = suggestions.photoTypes.map((s) => s.title);
  const allowedStyles = suggestions.stylePreferences.map((s) => s.title);
  const allowedFocus = suggestions.finalFocus.map((s) => s.title);
  const filterAllowedArray = (vals: string[], allowed: string[]) => vals.filter((v) => allowed.includes(v));
  if (currentStep >= 3) {
    if (
      formData.photoTypes.some((v) => !allowedPhotoTypes.includes(v)) ||
      (formData.personalization1 && !allowedStyles.includes(formData.personalization1)) ||
      (formData.personalization2 && !allowedFocus.includes(formData.personalization2))
    ) {
      setFormData((prev) => ({
        ...prev,
        photoTypes: filterAllowedArray(prev.photoTypes || [], allowedPhotoTypes),
        personalization1: allowedStyles.includes(prev.personalization1) ? prev.personalization1 : "",
        personalization2: allowedFocus.includes(prev.personalization2) ? prev.personalization2 : "",
      }));
    }
  }

  // Direction-aware variants for slide/fade transitions
  const stepVariants = {
    initial: (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
    animate: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40 }),
  } as const;

  // Steps: each question on its own screen
  const steps = [
    {
      id: "where",
      title: "Where did you travel?",
      render: (
                <PromptSection>
                  <div className="space-y-6 md:space-y-7">
                    <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
              <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Where did you travel? *</h3>
                    </div>
            <div role="group" aria-label="Select one or more destinations" className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                      {suggestions.destinations.map((dest) => (
                        <SuggestionCard
                          key={dest.title}
                          title={dest.title}
                          subtitle={dest.subtitle}
                          icon={dest.icon}
                  isSelected={formData.tripWheres.includes(dest.title)}
                  onClick={() => setFormData((p) => ({
                    ...p,
                    tripWheres: p.tripWheres.includes(dest.title)
                      ? p.tripWheres.filter((d) => d !== dest.title)
                      : p.tripWheres.concat(dest.title),
                  }))}
                          isLoading={isRegenerating}
                        />
                      ))}
                    </div>
                    <LocationAutocomplete
              value={whereInput}
              onChange={(v) => setWhereInput(v)}
              onCommit={(val) => {
                const v = (val || "").trim();
                if (!v) return;
                setFormData((p) => ({
                  ...p,
                  tripWheres: p.tripWheres.includes(v) ? p.tripWheres : p.tripWheres.concat(v),
                }));
              }}
                      placeholder="Or type your own destination..."
                      className="!p-3"
                    />
            {formData.tripWheres.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="q1-selected-list">
                {formData.tripWheres.map((loc) => (
                  <SelectedAnswerPill
                    key={loc}
                    icon={<MapPin size={16} className="shrink-0" />}
                    label={loc}
                    maxWidthClass="max-w-[180px]"
                    onRemove={() => setFormData((p) => ({ ...p, tripWheres: p.tripWheres.filter((x) => x !== loc) }))}
                  />
                ))}
              </div>
            ) : null}
                  </div>
                </PromptSection>
      ),
    },
    {
      id: "when",
      title: "When was your trip?",
      render: (
                <PromptSection>
                  <div className="space-y-6 md:space-y-7">
                    <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
              <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>When was your trip? *</h3>
                    </div>
                    <div role="radiogroup" aria-label="Select an option" className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                      {suggestions.timeframes.map((time) => (
                        <SuggestionCard
                          key={time.title}
                          title={time.title}
                          subtitle={time.subtitle}
                          icon={time.icon}
                          isSelected={formData.tripWhen === time.title}
                          onClick={() => setFormData((p) => ({ ...p, tripWhen: time.title }))}
                          isLoading={isRegenerating}
                        />
                      ))}
                    <div data-testid="q2-other-card" className="md:col-span-2 relative">
                      <SuggestionCard
                        key="Other"
                        title="Other"
                        subtitle="Pick a year and month/season"
                        icon={<Calendar size={24} />}
                        isSelected={false}
                        onClick={() => setIsTripDateOpen(true)}
                        isLoading={isRegenerating}
                      />
                {formData.tripWhen ? (
                        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                    <SelectedAnswerPill testId="q2-selected-pill" icon={<Calendar size={16} className="shrink-0" />} label={formData.tripWhen} />
                        </div>
                ) : null}
                    </div>
                    </div>
            <TripDateSelector isOpen={isTripDateOpen} onClose={() => setIsTripDateOpen(false)} onSelect={(label) => setFormData((p) => ({ ...p, tripWhen: label }))} />
                  </div>
                </PromptSection>
      ),
    },
    {
      id: "what",
      title: "What made this trip special?",
      render: (
                <PromptSection>
                  <div className="space-y-6 md:space-y-7">
                    <div data-testid="q3-heading-block" className="flex items-start gap-2 mb-2">
                      <span className="inline-flex shrink-0 items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
                      <div>
                        <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
                          What made this trip special? <span className="opacity-70 font-normal">(optional)</span>
                        </h3>
                        <p className="mt-1 text-[13px] text-[#4F6420]/70 tracking-wide">Choose up to 3</p>
                      </div>
                    </div>
                    <KeywordSelector
                      keywords={specialTripKeywords}
                      selected={formData.specialKeywords}
                      onChange={(arr) => setFormData((p) => ({ ...p, specialKeywords: arr.slice(0, 3) }))}
                      max={3}
                    />
                  </div>
                </PromptSection>
      ),
    },
    {
      id: "photos",
      title: "About your photos",
      render: (
              <PromptSection>
                <div className="space-y-6 md:space-y-7">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
                    <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Select all that apply *</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6" role="group" aria-label="Select an option">
                    {suggestions.photoTypes.map((item: any) => (
                      <SuggestionCard
                        key={item.title}
                        title={item.title}
                        subtitle={item.subtitle}
                        icon={item.icon}
                        isSelected={formData.photoTypes.includes(item.title)}
                        onClick={() => handlePhotoTypeToggle(item.title)}
                        isLoading={isRegenerating}
                      />
                    ))}
                  </div>
                </div>
              </PromptSection>
      ),
    },
    {
      id: "style",
      title: "Choose your preferred style",
      render: (
              <PromptSection>
                <div className="space-y-6 md:space-y-7">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
                    <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Choose your preferred style *</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6" role="radiogroup" aria-label="Select an option">
                    {suggestions.stylePreferences.map((item: any) => (
                      <SuggestionCard
                        key={item.title}
                        title={item.title}
                        subtitle={item.subtitle}
                        icon={item.icon}
                        isSelected={formData.personalization1 === item.title}
                        onClick={() => setFormData((p) => ({ ...p, personalization1: item.title }))}
                        isLoading={isRegenerating}
                      />
                    ))}
                  </div>
                </div>
              </PromptSection>
      ),
    },
    {
      id: "focus",
      title: "Your main focus",
      render: (
              <PromptSection>
                <div className="space-y-6 md:space-y-7">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#E8EBD1] text-[#6B8E23]">?</span>
                    <h3 className="text-[1.2rem] font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Your main focus *</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6" role="radiogroup" aria-label="Select an option">
                    {suggestions.finalFocus.map((item: any) => (
                    <SuggestionCard
                      key={item.title}
                      title={item.title}
                      subtitle={item.subtitle}
                      icon={item.icon}
                        isSelected={formData.personalization2 === item.title}
                        onClick={() => setFormData((p) => ({ ...p, personalization2: item.title }))}
                      isLoading={isRegenerating}
                    />
                  ))}
                </div>
              </div>
              </PromptSection>
      ),
    },
  ];

  const totalSteps = steps.length;

  const isStepValid = () => {
    switch (currentStep) {
      case 0:
        return formData.tripWheres.length > 0;
      case 1:
        return Boolean(formData.tripWhen);
      case 2:
        return true; // optional
      case 3:
        return formData.photoTypes.length > 0;
      case 4:
        return allowedStyles.includes(formData.personalization1);
      case 5:
        return allowedFocus.includes(formData.personalization2);
      default:
        return false;
    }
  };

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
                <h2 className="text-3xl font-serif font-semibold mb-3 tracking-wide" style={{ fontFamily: "Supernova, serif", color: "#4F6420" }}>
                  {steps[currentStep].title}
                </h2>
              </div>
              {steps[currentStep].render}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons (Next/Complete) */}
          <div className="flex justify-end items-center mt-12 pt-8 border-t border-border">
            <div>
            <button
                type="button"
              onClick={handleNext}
              disabled={!isStepValid() || isSubmitting}
              className="cta-button"
            >
                {isSubmitting ? "Saving..." : currentStep === totalSteps - 1 ? "Complete Journey" : "Continue"}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
