import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useIntent } from "@/state/intentStore";
import { FilmStripLoader } from "@/components/FilmStripLoader";

const DEBUG = (import.meta as any).env?.VITE_DEBUG_INTENT === "1";

/**
 * Intermediate page: displays a centered FilmStripLoader while prechoosing runs.
 * Automatically forwards to /onboarding when prefillReady === true or after a 10s safety timeout.
 */
export default function OnboardingLoading() {
  const navigate = useNavigate();
  const { prefillReady } = useIntent();

  useEffect(() => {
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn("[loader] safety timeout → proceeding to /onboarding");
      }
      navigate("/onboarding", { replace: true });
    }, 10000); // 10s safety

    if (prefillReady) {
      clearTimeout(t);
      if (!timedOut) navigate("/onboarding", { replace: true });
      return;
    }

    return () => clearTimeout(t);
  }, [prefillReady, navigate]);

  // Minimal, centered loader. No tinted overlay; underlying gradient remains visible.
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="min-h-screen flex items-center justify-center"
    >
      <FilmStripLoader />
      <span className="sr-only">Preparing your onboarding…</span>
    </div>
  );
}


