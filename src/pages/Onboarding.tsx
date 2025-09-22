import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressIndicator } from "@/components/ProgressIndicator";
import { useNavigate } from "react-router-dom";
import { supabase, UserAnswer } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface OnboardingData {
  tripWhere: string;
  tripWhen: string;
  tripWhat: string;
  photoCount: string;
  photoTypes: string[];
  personalization1: string;
  personalization2: string;
}

const photoTypeOptions = [
  "Nature & Landscapes",
  "Food & Dining", 
  "Group Photos",
  "Architecture",
  "Street Photography",
  "Adventure & Activities",
  "Cultural Experiences",
  "Sunset & Sunrise"
];

const personalizationQuestions = [
  "What style best captures your travel memories?",
  "What's most important in your photo stories?"
];

const personalizationOptions = [
  {
    question: 0,
    options: ["Classic & Timeless", "Modern & Vibrant", "Artistic & Creative", "Documentary Style"]
  },
  {
    question: 1,
    options: ["The Journey", "The Destinations", "The People", "The Experiences"]
  }
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<OnboardingData>({
    tripWhere: "",
    tripWhen: "",
    tripWhat: "",
    photoCount: "",
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
        photo_count: parseInt(formData.photoCount) || 0,
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

  const isStepValid = () => {
    switch (currentStep) {
      case 0:
        return formData.tripWhere && formData.tripWhen;
      case 1:
        return formData.photoCount && formData.photoTypes.length > 0;
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
            className="space-y-6"
          >
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-2">
                Tell us about your trip
              </h2>
              <p className="text-muted-foreground font-serif">
                Let's start with the basics
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="breathe">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Where did you travel? *
                </label>
                <Input
                  value={formData.tripWhere}
                  onChange={(e) => setFormData(prev => ({ ...prev, tripWhere: e.target.value }))}
                  placeholder="e.g., Paris, France"
                  className="journal-input"
                />
              </div>
              
              <div className="breathe">
                <label className="block text-sm font-medium text-foreground mb-2">
                  When was your trip? *
                </label>
                <Input
                  value={formData.tripWhen}
                  onChange={(e) => setFormData(prev => ({ ...prev, tripWhen: e.target.value }))}
                  placeholder="e.g., Summer 2024"
                  className="journal-input"
                />
              </div>
              
              <div className="breathe">
                <label className="block text-sm font-medium text-foreground mb-2">
                  What made this trip special? (optional)
                </label>
                <Textarea
                  value={formData.tripWhat}
                  onChange={(e) => setFormData(prev => ({ ...prev, tripWhat: e.target.value }))}
                  placeholder="Share a brief description of your adventure..."
                  className="journal-input min-h-20"
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
            className="space-y-6"
          >
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-2">
                About your photos
              </h2>
              <p className="text-muted-foreground font-serif">
                Help us understand your collection
              </p>
            </div>
            
            <div className="space-y-6">
              <div className="breathe">
                <label className="block text-sm font-medium text-foreground mb-2">
                  How many photos do you have? *
                </label>
                <Input
                  value={formData.photoCount}
                  onChange={(e) => setFormData(prev => ({ ...prev, photoCount: e.target.value }))}
                  placeholder="e.g., 50-100 photos"
                  className="journal-input"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-4">
                  What types of photos did you capture? * (select all that apply)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {photoTypeOptions.map((type) => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={type}
                        checked={formData.photoTypes.includes(type)}
                        onCheckedChange={() => handlePhotoTypeToggle(type)}
                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <label 
                        htmlFor={type} 
                        className="text-sm text-foreground cursor-pointer"
                      >
                        {type}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
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
            className="space-y-6"
          >
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-2">
                Personalize your story
              </h2>
              <p className="text-muted-foreground font-serif">
                {personalizationQuestions[0]}
              </p>
            </div>
            
            <div className="space-y-3">
              {personalizationOptions[0].options.map((option) => (
                <button
                  key={option}
                  onClick={() => setFormData(prev => ({ ...prev, personalization1: option }))}
                  className={`w-full p-4 text-left rounded-lg border transition-all duration-200 ${
                    formData.personalization1 === option
                      ? 'bg-primary text-primary-foreground border-primary shadow-vintage'
                      : 'bg-card hover:bg-warm-beige border-border shadow-soft'
                  }`}
                >
                  {option}
                </button>
              ))}
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
            className="space-y-6"
          >
            <div className="text-center mb-8">
              <h2 className="text-3xl font-serif font-semibold text-foreground mb-2">
                Final touch
              </h2>
              <p className="text-muted-foreground font-serif">
                {personalizationQuestions[1]}
              </p>
            </div>
            
            <div className="space-y-3">
              {personalizationOptions[1].options.map((option) => (
                <button
                  key={option}
                  onClick={() => setFormData(prev => ({ ...prev, personalization2: option }))}
                  className={`w-full p-4 text-left rounded-lg border transition-all duration-200 ${
                    formData.personalization2 === option
                      ? 'bg-primary text-primary-foreground border-primary shadow-vintage'
                      : 'bg-card hover:bg-warm-beige border-border shadow-soft'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </motion.div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen vintage-bg flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        <ProgressIndicator 
          currentStep={currentStep} 
          totalSteps={totalSteps} 
          className="mb-8"
        />
        
        <div className="bg-card rounded-lg shadow-vintage p-8 border border-border">
          <AnimatePresence mode="wait">
            {renderStep()}
          </AnimatePresence>
          
          <div className="flex justify-between mt-8 pt-6 border-t border-border">
            <Button
              onClick={handleBack}
              variant="outline"
              disabled={currentStep === 0}
              className="bg-transparent hover:bg-muted border-border"
            >
              Back
            </Button>
            
            <Button
              onClick={handleNext}
              disabled={!isStepValid() || isSubmitting}
              className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-soft transition-all duration-200 active:scale-95"
            >
              {isSubmitting ? "Saving..." : currentStep === totalSteps - 1 ? "Complete" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}