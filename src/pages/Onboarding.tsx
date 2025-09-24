import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { SuggestionCard } from "@/components/SuggestionCard";
import { CustomInput } from "@/components/CustomInput";
import { useNavigate } from "react-router-dom";
import { supabase, UserAnswer } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
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
  Sunset
} from "lucide-react";

interface OnboardingData {
  tripWhere: string;
  tripWhen: string;
  tripWhat: string;
  photoTypes: string[];
  personalization1: string;
  personalization2: string;
}

// Predefined suggestions for each step
const suggestions = {
  destinations: [
    { title: "Paris, France", subtitle: "City of Light", icon: <Building size={24} /> },
    { title: "Tokyo, Japan", subtitle: "Modern meets traditional", icon: <Building size={24} /> },
    { title: "Bali, Indonesia", subtitle: "Island paradise", icon: <Mountain size={24} /> },
    { title: "New York, USA", subtitle: "The Big Apple", icon: <Building size={24} /> },
  ],
  timeframes: [
    { title: "Summer 2024", subtitle: "June - August", icon: <Sunset size={24} /> },
    { title: "Spring 2024", subtitle: "March - May", icon: <Calendar size={24} /> },
    { title: "Winter 2023", subtitle: "December - February", icon: <Calendar size={24} /> },
    { title: "Fall 2024", subtitle: "September - November", icon: <Calendar size={24} /> },
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
  ]
};

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    tripWhere: "",
    tripWhen: "",
    tripWhat: "",
    photoTypes: [],
    personalization1: "",
    personalization2: ""
  });
  const navigate = useNavigate();
  const { toast } = useToast();

  const totalSteps = 4;

  const handleNext = async () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      await handleSubmit();
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      // Get current user (might be null for "Get Started" flow)
      const { data: { user } } = await supabase.auth.getUser();
      
      const answerData = {
        user_id: user?.id || null,
        trip_where: formData.tripWhere,
        trip_when: formData.tripWhen,
        trip_what: formData.tripWhat || null,
        photo_types: formData.photoTypes,
        personalization_q1: formData.personalization1,
        personalization_q2: formData.personalization2
      };

      const { error } = await supabase
        .from('user_answers')
        .insert([answerData]);

      if (error) {
        throw error;
      }

      toast({
        title: "Success!",
        description: "Your travel story preferences have been saved.",
      });

      navigate("/coming-soon");
    } catch (error) {
      console.error('Error saving answers:', error);
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handlePhotoTypeToggle = (type: string) => {
    setFormData(prev => ({
      ...prev,
      photoTypes: prev.photoTypes.includes(type) 
        ? prev.photoTypes.filter(t => t !== type)
        : [...prev.photoTypes, type]
    }));
  };

  const handleRegenerateSuggestions = async () => {
    setIsRegenerating(true);
    // Simulate API call to OpenAI - placeholder for now
    setTimeout(() => {
      setIsRegenerating(false);
      toast({
        title: "Feature coming soon!",
        description: "AI-powered suggestions will be available in the next update.",
      });
    }, 1500);
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 0:
        return formData.tripWhere && formData.tripWhen;
      case 1:
        return formData.photoTypes.length > 0;
      case 2:
        return formData.personalization1;
      case 3:
        return formData.personalization2;
      default:
        return false;
    }
  };

  const renderStep = () => {
    const stepVariants = {
      hidden: { opacity: 0, x: 50 },
      visible: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -50 }
    };

    switch (currentStep) {
      case 0:
        return (
          <motion.div 
            key="step-0"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <div className="text-center">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-3">
                Tell us about your trip
              </h2>
              <p className="text-muted-foreground font-serif text-lg">
                Let's start with the basics
              </p>
            </div>
            
            <div className="space-y-6">
              {/* Where suggestions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-lg font-medium text-foreground">
                    Where did you travel? *
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRegenerateSuggestions}
                    disabled={isRegenerating}
                    className="text-primary hover:text-primary/80"
                  >
                    <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
                    Regenerate
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {suggestions.destinations.map((dest) => (
                    <SuggestionCard
                      key={dest.title}
                      title={dest.title}
                      subtitle={dest.subtitle}
                      icon={dest.icon}
                      isSelected={formData.tripWhere === dest.title}
                      onClick={() => setFormData(prev => ({ ...prev, tripWhere: dest.title }))}
                      isLoading={isRegenerating}
                    />
                  ))}
                </div>
                
                <CustomInput
                  placeholder="Or type your own destination..."
                  value={formData.tripWhere}
                  onChange={(value) => setFormData(prev => ({ ...prev, tripWhere: value }))}
                />
              </div>

              {/* When suggestions */}
              <div className="space-y-4">
                <label className="text-lg font-medium text-foreground">
                  When was your trip? *
                </label>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {suggestions.timeframes.map((time) => (
                    <SuggestionCard
                      key={time.title}
                      title={time.title}
                      subtitle={time.subtitle}
                      icon={time.icon}
                      isSelected={formData.tripWhen === time.title}
                      onClick={() => setFormData(prev => ({ ...prev, tripWhen: time.title }))}
                      isLoading={isRegenerating}
                    />
                  ))}
                </div>
                
                <CustomInput
                  placeholder="Or type when you traveled..."
                  value={formData.tripWhen}
                  onChange={(value) => setFormData(prev => ({ ...prev, tripWhen: value }))}
                />
              </div>

              {/* Optional description */}
              <div className="space-y-2">
                <label className="text-lg font-medium text-foreground">
                  What made this trip special? (optional)
                </label>
                <Textarea
                  value={formData.tripWhat}
                  onChange={(e) => setFormData(prev => ({ ...prev, tripWhat: e.target.value }))}
                  placeholder="Share a brief description of your adventure..."
                  className="journal-input min-h-24"
                />
              </div>
            </div>
          </motion.div>
        );
        
      case 1:
        return (
          <motion.div
            key="step-1"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <div className="text-center">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-3">
                About your photos
              </h2>
              <p className="text-muted-foreground font-serif text-lg">
                What types of photos did you capture?
              </p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="text-lg font-medium text-foreground">
                  Select all that apply *
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerateSuggestions}
                  disabled={isRegenerating}
                  className="text-primary hover:text-primary/80"
                >
                  <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
                  Regenerate
                </Button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suggestions.photoTypes.map((type) => (
                  <SuggestionCard
                    key={type.title}
                    title={type.title}
                    subtitle={type.subtitle}
                    icon={type.icon}
                    isSelected={formData.photoTypes.includes(type.title)}
                    onClick={() => handlePhotoTypeToggle(type.title)}
                    isLoading={isRegenerating}
                  />
                ))}
              </div>
              
              <CustomInput
                placeholder="Or add your own photo type..."
                value=""
                onChange={() => {}}
                onAddChip={(value) => handlePhotoTypeToggle(value)}
                chips={formData.photoTypes.filter(type => 
                  !suggestions.photoTypes.some(s => s.title === type)
                )}
                onRemoveChip={(index) => {
                  const customTypes = formData.photoTypes.filter(type => 
                    !suggestions.photoTypes.some(s => s.title === type)
                  );
                  const typeToRemove = customTypes[index];
                  if (typeToRemove) {
                    handlePhotoTypeToggle(typeToRemove);
                  }
                }}
                multiSelect
              />
            </div>
          </motion.div>
        );
        
      case 2:
        return (
          <motion.div
            key="step-2"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <div className="text-center">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-3">
                Personalize your story
              </h2>
              <p className="text-muted-foreground font-serif text-lg">
                What style best captures your travel memories?
              </p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="text-lg font-medium text-foreground">
                  Choose your preferred style *
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerateSuggestions}
                  disabled={isRegenerating}
                  className="text-primary hover:text-primary/80"
                >
                  <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
                  Regenerate
                </Button>
              </div>
              
              <div className="space-y-3">
                {suggestions.stylePreferences.map((style) => (
                  <SuggestionCard
                    key={style.title}
                    title={style.title}
                    subtitle={style.subtitle}
                    icon={style.icon}
                    isSelected={formData.personalization1 === style.title}
                    onClick={() => setFormData(prev => ({ ...prev, personalization1: style.title }))}
                    isLoading={isRegenerating}
                  />
                ))}
              </div>
              
              <CustomInput
                placeholder="Or describe your own style..."
                value={formData.personalization1}
                onChange={(value) => setFormData(prev => ({ ...prev, personalization1: value }))}
              />
            </div>
          </motion.div>
        );
        
      case 3:
        return (
          <motion.div
            key="step-3"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <div className="text-center">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-3">
                Final touch
              </h2>
              <p className="text-muted-foreground font-serif text-lg">
                What's most important in your photo stories?
              </p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="text-lg font-medium text-foreground">
                  Your main focus *
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerateSuggestions}
                  disabled={isRegenerating}
                  className="text-primary hover:text-primary/80"
                >
                  <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
                  Regenerate
                </Button>
              </div>
              
              <div className="space-y-3">
                {suggestions.finalFocus.map((focus) => (
                  <SuggestionCard
                    key={focus.title}
                    title={focus.title}
                    subtitle={focus.subtitle}
                    icon={focus.icon}
                    isSelected={formData.personalization2 === focus.title}
                    onClick={() => setFormData(prev => ({ ...prev, personalization2: focus.title }))}
                    isLoading={isRegenerating}
                  />
                ))}
              </div>
              
              <CustomInput
                placeholder="Or tell us your focus..."
                value={formData.personalization2}
                onChange={(value) => setFormData(prev => ({ ...prev, personalization2: value }))}
              />
            </div>
          </motion.div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen vintage-bg flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        <ProgressIndicator 
          currentStep={currentStep} 
          totalSteps={totalSteps} 
          className="mb-12"
        />
        
        <div className="bg-card rounded-2xl shadow-vintage p-8 md:p-12 border border-border">
          <AnimatePresence mode="wait">
            {renderStep()}
          </AnimatePresence>
          
          <div className="flex justify-between items-center mt-12 pt-8 border-t border-border">
            <Button
              onClick={handleBack}
              variant="ghost"
              disabled={currentStep === 0}
              className="text-muted-foreground hover:text-foreground"
            >
              Back
            </Button>
            
            <button
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
  );
}