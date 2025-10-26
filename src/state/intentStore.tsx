import { createContext, useContext, useState, ReactNode } from "react";
import type { TripIntent } from "@/lib/intent/parseTripIntent";

type IntentContextValue = {
  intent: TripIntent | null;
  rawInput: string | null;
  setIntent: (intent: TripIntent | null, meta?: { raw?: string }) => void;
};

const IntentContext = createContext<IntentContextValue | undefined>(undefined);

export function IntentProvider({ children }: { children: ReactNode }) {
  const [intent, setIntentState] = useState<TripIntent | null>(null);
  const [rawInput, setRawInput] = useState<string | null>(null);

  const setIntent = (value: TripIntent | null, meta?: { raw?: string }) => {
    setIntentState(value);
    if (meta && Object.prototype.hasOwnProperty.call(meta, "raw")) {
      setRawInput(meta?.raw ?? null);
    }
  };

  return (
    <IntentContext.Provider value={{ intent, rawInput, setIntent }}>
      {children}
    </IntentContext.Provider>
  );
}

export function useIntent() {
  const ctx = useContext(IntentContext);
  if (!ctx) {
    throw new Error("useIntent must be used within an IntentProvider");
  }
  return ctx;
}
