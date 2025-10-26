import { createContext, useContext, useState, ReactNode } from "react";
import type { TripIntent } from "@/lib/intent/parseTripIntent";

type IntentContextValue = {
  intent: TripIntent | null;
  rawInput: string | null;
  setIntent: (value: TripIntent | null, meta?: { raw?: string }) => void;

  // NEW: prechoosing/prefill readiness
  prefillReady: boolean;
  setPrefillReady: (ready: boolean) => void;
};

const IntentContext = createContext<IntentContextValue | null>(null);

export function IntentProvider({ children }: { children: ReactNode }) {
  const [intent, setIntentState] = useState<TripIntent | null>(null);
  const [rawInput, setRawInput] = useState<string | null>(null);
  const [prefillReady, setPrefillReady] = useState<boolean>(false);

  const setIntent = (value: TripIntent | null, meta?: { raw?: string }) => {
    setIntentState(value);
    if (meta && Object.prototype.hasOwnProperty.call(meta, "raw")) {
      setRawInput(meta?.raw ?? null);
    }
  };

  return (
    <IntentContext.Provider value={{ intent, rawInput, setIntent, prefillReady, setPrefillReady }}>
      {children}
    </IntentContext.Provider>
  );
}

export function useIntent(): IntentContextValue {
  const ctx = useContext(IntentContext);
  if (!ctx) {
    throw new Error("useIntent must be used within an IntentProvider");
  }
  return ctx;
}
