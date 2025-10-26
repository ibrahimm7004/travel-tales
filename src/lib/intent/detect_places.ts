import countryCodesJson from "@/data/country_codes.json";
import topCitiesJson from "@/data/top_cities.json";

const DEBUG = (import.meta as any).env?.VITE_DEBUG_INTENT === '1';

function debug(...args: any[]) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[intent-debug]", ...args);
  }
}

// --- Embedded fallbacks (used if JSON dictionaries fail/empty) ---
const FALLBACK_COUNTRIES = [
  { name: "Italy", iso2: "it" },
  { name: "Japan", iso2: "jp" },
  { name: "France", iso2: "fr" },
  { name: "Spain", iso2: "es" },
  { name: "United States", iso2: "us" },
  { name: "United Kingdom", iso2: "gb" }
];
const FALLBACK_CITIES = [
  "Rome", "Venice", "Florence", "Paris", "Barcelona", "Madrid",
  "London", "Tokyo", "Kyoto", "Osaka", "New York", "Los Angeles"
];

// Normalize JSON inputs, with robust fallback if empty
const COUNTRY_LIST: Array<{ name: string; iso2: string }> = (() => {
  try {
    const arr = (countryCodesJson as any[]) || [];
    const norm = arr
      .map((c: any) => ({ name: String(c?.name ?? ""), iso2: String(c?.iso2 ?? "") }))
      .filter(c => c.name && c.iso2);
    return norm.length ? norm : FALLBACK_COUNTRIES;
  } catch {
    return FALLBACK_COUNTRIES;
  }
})();

const CITY_LIST: string[] = (() => {
  try {
    const arr = (topCitiesJson as any[]) || [];
    const norm = arr
      .map((c: any) => (typeof c === "string" ? c : (c?.name ?? c?.city ?? c?.label)))
      .filter(Boolean)
      .map((s: any) => String(s));
    return norm.length ? norm : FALLBACK_CITIES;
  } catch {
    return FALLBACK_CITIES;
  }
})();

debug("dict sizes", { countries: COUNTRY_LIST.length, cities: CITY_LIST.length });

// Maps/sets (lowercased)
const COUNTRY_SET = new Set(COUNTRY_LIST.map(c => c.name.toLowerCase()));
const COUNTRY_NAME_TO_ISO = new Map(COUNTRY_LIST.map(c => [c.name.toLowerCase(), c.iso2.toLowerCase()]));
const CITY_SET = new Set(CITY_LIST.map(n => n.toLowerCase()));

// Tokenization helpers
const WORD = /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F][A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F\.'\u2019\-]*/g;

const MONTH_KEYS = [
  "jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"
];
const SEASON_KEYS = ["spring","summer","autumn","fall","winter"];

const NON_PLACE_WORDS = new Set([
  "romantic","honeymoon","family","luxury","budget","adventure",
  ...MONTH_KEYS,
  ...SEASON_KEYS
]);

const CONNECTOR_RE = /^(of|de|del|da|di|do|la|le|los|las|saint|st|san|santa|rio|new|ho|chi|minh|de|al|el|cape)$/i;

// Helper: strong segment split to avoid cross-phrase spans (em dash, punctuation)
function splitSegments(text: string): string[] {
  return (text || "")
    .replace(/—|–/g, " — ")
    .split(/[\s]*[;:,.!?](?:\s+)|\s+—\s+|\s+-\s+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

// Guardrails for fallback phrases
function isValidFallbackPhrase(tokens: string[]): boolean {
  if (tokens.length < 2 || tokens.length > 4) return false;
  const joinedLower = tokens.join(" ").toLowerCase();
  if (NON_PLACE_WORDS.has(joinedLower)) return false;
  const hasLong = tokens.some(t => t.length >= 3);
  if (!hasLong) return false;
  const first = tokens[0];
  if (!/^[A-Z\u00C0-\u00D6\u00D8-\u00DE]/.test(first)) return false;
  return true;
}

/** Improved fallback detection: per segment, capitalized phrases with connectors */
function fallbackCapitalizedMentions(text: string): PlaceMention[] {
  const segments = splitSegments(text);
  const out: PlaceMention[] = [];
  for (const seg of segments) {
    const words = seg.match(WORD) || [];
    let buf: string[] = [];
    for (const w of words) {
      const isCap = /^[A-Z\u00C0-\u00D6\u00D8-\u00DE]/.test(w);
      const isConnector = CONNECTOR_RE.test(w);
      if (isCap || (buf.length && isConnector)) {
        buf.push(w);
      } else {
        if (buf.length && isValidFallbackPhrase(buf)) {
          out.push({ phrase: buf.join(" "), kind: "city", source: "fallback" });
        }
        buf = isCap ? [w] : [];
      }
    }
    if (buf.length && isValidFallbackPhrase(buf)) {
      out.push({ phrase: buf.join(" "), kind: "city", source: "fallback" });
    }
  }

  const seen = new Set<string>();
  return out.filter(m => {
    const k = `${m.kind}:${m.phrase.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type PlaceMention =
  | { phrase: string; kind: "country"; source: "dict" | "fallback" }
  | { phrase: string; kind: "city";    source: "dict" | "fallback" };

export function detectPlaceMentions(text: string): PlaceMention[] {
  const orig = (text || "").normalize("NFKC");
  const words = orig.match(WORD) || [];
  const lowerWords = words.map(w => w.toLowerCase());
  const taken = new Array(lowerWords.length).fill(false);
  const mentions: PlaceMention[] = [];

  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i <= lowerWords.length - n; i++) {
      if (taken.slice(i, i + n).some(Boolean)) continue;
      const gramLower = lowerWords.slice(i, i + n).join(" ");
      const gramOrig = words.slice(i, i + n).join(" ");
      if (COUNTRY_SET.has(gramLower)) {
        mentions.push({ phrase: gramOrig, kind: "country", source: "dict" });
        taken.fill(true, i, i + n);
        continue;
      }
      if (CITY_SET.has(gramLower)) {
        mentions.push({ phrase: gramOrig, kind: "city", source: "dict" });
        taken.fill(true, i, i + n);
        continue;
      }
    }
  }

  const fallback = fallbackCapitalizedMentions(orig).filter(f => {
    const key = f.phrase.toLowerCase();
    const dup = mentions.some(m => m.phrase.toLowerCase() === key);
    if (dup) return false;
    if (NON_PLACE_WORDS.has(key)) return false;
    return true;
  });

  const all = [...mentions, ...fallback];

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[detect_places] mentions:", all);
  }

  return all;
}

// ISO2 codes explicitly mentioned in text (lowercase)
export function detectCountryBias(text: string): string[] {
  const lowerText = (text || "").normalize("NFKC").toLowerCase();
  const out = new Set<string>();
  for (const { name, iso2 } of COUNTRY_LIST) {
    const re = new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(lowerText)) out.add(iso2.toLowerCase());
  }
  return Array.from(out);
}

// Map a country display name to iso2 if present in list
export function isoFromCountryName(name?: string): string | undefined {
  if (!name) return undefined;
  return COUNTRY_NAME_TO_ISO.get(name.toLowerCase());
}
