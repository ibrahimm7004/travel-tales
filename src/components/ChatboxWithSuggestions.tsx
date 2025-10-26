import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import { Button as MovingBorder } from "@/components/ui/moving-border";
import { parseTripIntent, logTripIntent } from "@/lib/intent/parseTripIntent";
import { saveIntentToFile } from "@/lib/intent/saveToFile";
import { useIntent } from "@/state/intentStore";

interface ChatboxWithSuggestionsProps {
  onSend: (message: string) => void;
}

const suggestionTexts = [
  "I visited Italy this summer for my honeymoon with my fiancé. I want to make the most romantic photos.",
  "Family trip to NYC with the kids, extract our best shots at famous spots.",
  "Backpacked across Japan! The highlights should be street food, temples, and night alleys.",
  "Safari in Kenya. Pick the sharpest wildlife moments and golden-hour shots.",
  "Beach week in Bali. I want to keep sunsets, waves, and the most serene frames."
];

export function ChatboxWithSuggestions({ onSend }: ChatboxWithSuggestionsProps) {
  const [message, setMessage] = useState("");
  const [typedPrompt, setTypedPrompt] = useState("");
  const typedPromptRef = useRef<string>("");
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const loopIdxRef = useRef(0);
  const phaseRef = useRef<"typing" | "holding" | "erasing">("typing");
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const intentAbortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();
  const { setIntent } = useIntent();
  
  const clearTimers = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    rafRef.current = null;
  };

  const stopTypingAnimation = () => {
    if (hasUserInteracted) return;
    setHasUserInteracted(true);
    clearTimers();
    setTypedPrompt("");
    typedPromptRef.current = "";
  };

  const handleSend = async () => {
    // Temporarily allow empty submissions and route directly to onboarding
    const payload = message.trim() || typedPrompt.trim();
    onSend?.(payload);

    // Run local parser (terminal only) before navigation; abort previous if in-flight
    try {
      if (intentAbortRef.current) intentAbortRef.current.abort();
      const controller = new AbortController();
      intentAbortRef.current = controller;
      const intent = await parseTripIntent(payload, controller.signal);
      logTripIntent(intent, payload);
      setIntent(intent, { raw: payload });
      // Save to file via backend (dev only) and await before navigation
      await saveIntentToFile(payload, intent);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[TripIntent] error", e);
      setIntent(null);
    }

    setMessage("");
    navigate("/onboarding");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Typewriter loop
  useEffect(() => {
    const typeDelay = 15; // ~15% slower typing
    const eraseDelay = 10; // ~20% slower deleting
    const holdMs = 2000;
    const interPhrasePauseMs = 250; // brief pause between phrases when empty

    if (hasUserInteracted || message.length > 0) {
      clearTimers();
      return;
    }

    const prompts = suggestionTexts;
    const step = () => {
      const current = prompts[loopIdxRef.current % prompts.length];
      if (phaseRef.current === "typing") {
        const nextLen = typedPromptRef.current.length + 1;
        if (nextLen <= current.length) {
          const next = current.slice(0, nextLen);
          typedPromptRef.current = next;
          setTypedPrompt(next);
          timerRef.current = window.setTimeout(() => {
            rafRef.current = requestAnimationFrame(step);
          }, typeDelay);
        } else {
          phaseRef.current = "holding";
          timerRef.current = window.setTimeout(() => {
            phaseRef.current = "erasing";
            rafRef.current = requestAnimationFrame(step);
          }, holdMs);
        }
      } else if (phaseRef.current === "erasing") {
        const nextLen = typedPromptRef.current.length - 1;
        if (nextLen >= 0) {
          const next = typedPromptRef.current.slice(0, Math.max(0, typedPromptRef.current.length - 1));
          typedPromptRef.current = next;
          setTypedPrompt(next);
          timerRef.current = window.setTimeout(() => {
            rafRef.current = requestAnimationFrame(step);
          }, eraseDelay);
        } else {
          // now empty: brief natural pause before next phrase
          phaseRef.current = "typing";
          loopIdxRef.current = (loopIdxRef.current + 1) % prompts.length;
          timerRef.current = window.setTimeout(() => {
            rafRef.current = requestAnimationFrame(step);
          }, interPhrasePauseMs);
        }
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      clearTimers();
    };
  }, [hasUserInteracted, message]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Main Chatbox */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative"
      >
        <MovingBorder
          as="div"
          borderRadius="1.5rem"
          duration={1000}
          className="bg-[hsl(var(--card))] text-[hsl(var(--foreground))] border-transparent"
          borderClassName="opacity-90"   
          containerClassName="relative w-full overflow-hidden rounded-2xl"
        >
          <div className="relative rounded-2xl border border-border shadow-vintage">
          <textarea
            value={hasUserInteracted ? message : (message.length ? message : typedPrompt)}
            onChange={(e) => {
              if (!hasUserInteracted) stopTypingAnimation();
              setMessage(e.target.value);
            }}
            onFocus={stopTypingAnimation}
            onKeyPress={handleKeyPress}
            aria-live="polite"
            placeholder={hasUserInteracted ? "Tell us about your trip" : ""}
            className="w-full bg-transparent border-0 rounded-2xl px-6 py-4 pr-16 placeholder-[#7A983F] text-[#6B8E23] placeholder:italic font-sans text-base leading-relaxed resize-none outline-none transition-all duration-200 focus:scale-[1.01]"
            rows={4}
          />
          
          {/* Send Button */}
          <button
            onClick={handleSend}
            className="absolute bottom-4 right-4 w-10 h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center transition-all duration-200 transform-gpu disabled:opacity-50 disabled:cursor-not-allowed hover:scale-110 active:scale-95 shadow-soft hover:shadow-vintage"
          >
            <Send size={20} />
          </button>
          </div>
        </MovingBorder>
      </motion.div>

    </div>
  );
}
