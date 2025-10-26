import { TripIntent, MONTH_FULL } from "../intent/parseTripIntent";
import { HIGHLIGHT_OPTIONS } from "@/pages/onboarding/StepHighlights";

const DEBUG = (import.meta as any).env?.VITE_DEBUG_INTENT === "1";

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

const similar = (a: string, b: string) => lev(a.toLowerCase(), b.toLowerCase()) <= 1;

function unique<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

const titleCase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value);

export function toFullMonths(keys: string[] = [], fallback?: string[]): string[] {
  if (fallback && fallback.length) return fallback;
  return keys.map((key) => MONTH_FULL[key] ?? key);
}

export function computePrefillWhere(intent: TripIntent | null | undefined): string[] {
  if (!intent) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const loc of intent.locations.detected) {
    if (loc.kind === "country" && loc.country && !seen.has(loc.country)) {
      out.push(loc.country);
      seen.add(loc.country);
    }
  }
  for (const loc of intent.locations.detected) {
    if (loc.kind === "city" && loc.city && !seen.has(loc.city)) {
      out.push(loc.city);
      seen.add(loc.city);
    }
  }
  return out;
}

export function computePrefillWhen(intent: TripIntent | null | undefined): string | undefined {
  if (!intent) return undefined;
  const monthsFull = toFullMonths(intent.months, intent.monthsFull).filter(Boolean);
  if (monthsFull.length) {
    const joined = monthsFull.slice(0, 3).join(monthsFull.length > 1 ? " – " : "");
    return joined;
  }
  if (intent.season) {
    return titleCase(intent.season === "autumn" ? "Autumn" : intent.season);
  }
  return undefined;
}

export function extractDetectedKeywords(intent: TripIntent | null | undefined): string[] {
  if (!intent) return [];
  const list = [...(intent.keywords.activities || []), ...(intent.keywords.vibes || [])].map((k) => k.toLowerCase());
  return unique(list);
}

export function computePrefillKeywords(intent: TripIntent | null | undefined, defaults: string[], cap = 3) {
  const detected = extractDetectedKeywords(intent);
  if (!detected.length) {
    return { options: defaults, preselected: [] as string[] };
  }
  const uniqueDetected = unique(detected);
  const merged = [...uniqueDetected.slice(0, defaults.length)];
  if (defaults.length > uniqueDetected.length) {
    merged.push(...defaults.slice(uniqueDetected.length));
  }
  const preselected = uniqueDetected.slice(0, cap);
  if (DEBUG) {
    console.log("[prefill] keywords", { detected, merged, preselected });
  }
  return { options: merged, preselected };
}

const HIGHLIGHT_SYNONYMS: Record<string, string[]> = {
  cultureHeritage: ["culture", "heritage", "festival", "festivals", "tradition", "traditions", "experience", "experiences"],
  museumsArt: ["museum", "museums", "art", "gallery", "galleries", "exhibit", "exhibits"],
  historyLandmarks: ["history", "historical", "landmark", "landmarks", "unesco", "monument", "monuments", "destination", "destinations"],
};

export function computePrefillHighlights(intent: TripIntent | null | undefined, cap = 2): string[] {
  const detected = extractDetectedKeywords(intent);
  if (!detected.length) return [];
  const lowercaseKeywords = detected.map((k) => k.toLowerCase());
  const matched: string[] = [];
  for (const card of HIGHLIGHT_OPTIONS) {
    const synonyms = HIGHLIGHT_SYNONYMS[card.key] || [];
    const hay = `${card.title} ${card.subtitle || ""} ${synonyms.join(" ")}`.toLowerCase();
    for (const kw of lowercaseKeywords) {
      if (hay.includes(kw) || similar(hay, kw)) {
        matched.push(card.key);
        break;
      }
    }
  }
  const uniqueMatched = unique(matched).slice(0, cap);
  if (DEBUG) {
    console.log("[prefill] highlights", { detected, uniqueMatched });
  }
  return uniqueMatched;
}
