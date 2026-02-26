import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { IntentProvider } from "@/state/intentStore";
import { PipelineProgressProvider } from "@/state/pipelineProgress";
import PipelineProgressBar from "@/components/PipelineProgressBar";
import Index from "./pages/Index";
import Home from "./pages/Home";
import Onboarding from "./pages/Onboarding";
import OnboardingLoading from "@/pages/onboarding/OnboardingLoading";
import Upload from "./pages/Upload";
import Processing from "./pages/Processing";
import StepAResults from "./pages/StepAResults";
import StepAOutputs from "./pages/StepAOutputs";
import DINOOnlyResults from "./pages/DINOOnlyResults";
import ClipNamingDetails from "./pages/ClipNamingDetails";
import StepBResults from "./pages/StepBResults";
import { DEMO_RESULTS } from "@/pages/results/demoConfig";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <IntentProvider>
        <PipelineProgressProvider>
          <BrowserRouter>
            <PipelineProgressBar />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/home" element={<Home />} />
              <Route path="/onboarding/loading" element={<OnboardingLoading />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/processing" element={<Processing />} />
              <Route path="/results/step-a" element={DEMO_RESULTS ? <StepAOutputs /> : <StepAResults />} />
              {DEMO_RESULTS ? <Route path="/results/dino-only" element={<DINOOnlyResults />} /> : null}
              {DEMO_RESULTS ? <Route path="/results/clip-naming" element={<ClipNamingDetails />} /> : null}
              <Route path="/results/step-b" element={<StepBResults />} />
              <Route path="/coming-soon" element={<ComingSoon />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </PipelineProgressProvider>
      </IntentProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
