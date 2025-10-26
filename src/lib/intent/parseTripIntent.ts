import { detectLocationsWithNominatim, DetectedLocation } from "./geo_osm";
import { detectPlaceMentions, isoFromCountryName, PlaceMention } from "./detect_places";
import { ACTIVITY_KEYWORDS, VIBE_KEYWORDS } from "./keywords";

const DEBUG = (import.meta as any).env?.VITE_DEBUG_INTENT === '1';

// --- Levenshtein (tiny) for fuzzy month/season/country names ---
function levenshtein(a: string, b: string): number {
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
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

const similar = (a: string, b: string, tol = 1) => levenshtein(a.toLowerCase(), b.toLowerCase()) <= tol;

// --- Months & seasons lexicon with abbreviations ---
const MONTH_MAP: Record<string, string> = {
  jan: "jan", january: "jan",
  feb: "feb", february: "feb",
  mar: "mar", march: "mar",
  apr: "apr", april: "apr",
  may: "may",
  jun: "jun", june: "jun",
  jul: "jul", july: "jul",
  aug: "aug", august: "aug",
  sep: "sep", sept: "sep", september: "sep",
  oct: "oct", october: "oct",
  nov: "nov", november: "nov",
  dec: "dec", december: "dec",
};

export const MONTH_FULL: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};

const MONTH_KEYS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"] as const;
const SEASONS = ["spring","summer","autumn","fall","winter"] as const;
type SeasonName = typeof SEASONS[number];

function monthKeyFromToken(tok: string): string | null {
  const lower = tok.toLowerCase();
  if (MONTH_MAP[lower]) return MONTH_MAP[lower];
  if (lower.length >= 4) {
    for (const key of Object.keys(MONTH_MAP)) {
      if (similar(lower, key, 1)) return MONTH_MAP[key];
    }
  }
  return null;
}

function parseMonthsWithRanges(input: string): string[] {
  const tokens = (input.match(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F]+/g) || []);
  const found = new Set<string>();

  for (const w of tokens) {
    const mk = monthKeyFromToken(w);
    if (mk) found.add(mk);
  }

  const rangeRe = /\b([A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F]{3,9})\s*[\-–—]\s*([A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F]{3,9})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(input))) {
    const a = monthKeyFromToken(m[1]);
    const b = monthKeyFromToken(m[2]);
    if (!a || !b) continue;
    const ai = MONTH_KEYS.indexOf(a as typeof MONTH_KEYS[number]);
    const bi = MONTH_KEYS.indexOf(b as typeof MONTH_KEYS[number]);
    if (ai >= 0) found.add(MONTH_KEYS[ai]);
    if (bi >= 0) found.add(MONTH_KEYS[bi]);
  }

  return Array.from(found);
}

function detectSeason(input: string): SeasonName | undefined {
  const words = (input.match(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F]+/g) || []).map(s => s.toLowerCase());
  for (const s of SEASONS) {
    if (words.includes(s)) return s;
    if (words.includes(`${s}s`)) return s;
  }
  if (words.some(t => similar(t, "winter", 1))) return "winter";
  if (words.some(t => similar(t, "summer", 1))) return "summer";
  if (words.some(t => similar(t, "spring", 1))) return "spring";
  if (words.some(t => similar(t, "autumn", 1) || similar(t, "fall", 1))) return "autumn";
  return undefined;
}

type ValidatedLocal =
  | { kind: "country"; text: string; country: string; countryCode?: string; source: "dict" }
  | { kind: "city"; text: string; city: string; country?: string; countryCode?: string; source: "dict" | "fallback-validated" };

async function validateFallbackMentions(
  mentions: PlaceMention[],
  singleCountry?: { name: string; iso?: string },
  signal?: AbortSignal
): Promise<ValidatedLocal[]> {
  const out: ValidatedLocal[] = [];
  const dictCountries = mentions.filter(m => m.kind === "country" && m.source === "dict");
  const dictCities = mentions.filter(m => m.kind === "city" && m.source === "dict");
  const fallbacks = mentions.filter(m => m.kind === "city" && m.source === "fallback");

  const seenCountries = new Set<string>();
  for (const c of dictCountries) {
    const key = c.phrase.toLowerCase();
    if (seenCountries.has(key)) continue;
    seenCountries.add(key);
    out.push({
      kind: "country",
      text: c.phrase,
      country: c.phrase,
      countryCode: isoFromCountryName(c.phrase),
      source: "dict",
    });
  }

  const seenCities = new Set<string>();
  for (const c of dictCities) {
    const key = c.phrase.toLowerCase();
    if (seenCities.has(key)) continue;
    seenCities.add(key);
    out.push({
      kind: "city",
      text: c.phrase,
      city: c.phrase,
      country: singleCountry?.name,
      countryCode: singleCountry?.iso,
      source: "dict",
    });
  }

  const cap = Math.min(fallbacks.length, 5);
  for (let i = 0; i < cap; i++) {
    const f = fallbacks[i];
    try {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const res = await detectLocationsWithNominatim(f.phrase, {
        signal,
        limit: 1,
        biasCountryCodes: singleCountry?.iso ? [singleCountry.iso] : undefined,
      });
      if (res && res.length) {
        const top = res[0];
        const acceptableTypes = new Set([
          "city","town","village","hamlet","suburb","neighbourhood","island",
          "boundary","administrative","place","tourism"
        ]);
        const cityMatch = top.city && top.city.localeCompare(f.phrase, undefined, { sensitivity: "accent" }) === 0;
        const labelMatch = top.label && top.label.localeCompare(f.phrase, undefined, { sensitivity: "accent" }) === 0;
        const type = (top.rawType || "").toLowerCase();
        const cls = (top.rawClass || "").toLowerCase();
        const scoreOK = (top.score ?? 0) >= 0.35 && (acceptableTypes.has(type) || acceptableTypes.has(cls));
        if (cityMatch || labelMatch || scoreOK) {
          out.push({
            kind: "city",
            text: f.phrase,
            city: f.phrase,
            country: top.country ?? singleCountry?.name,
            countryCode: top.countryCode ?? singleCountry?.iso,
            source: "fallback-validated",
          });
        } else if (DEBUG) {
          // eslint-disable-next-line no-console
          console.log("[fallback-drop] low confidence", f.phrase, top);
        }
      } else if (DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[fallback-drop] no OSM hit", f.phrase);
      }
    } catch (e) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn("[fallback-validate] error", f.phrase, e);
      }
    }
  }

  return out;
}

export type LocalPlaceDetected = {
  kind: "country" | "city";
  text: string;
  city?: string;
  country?: string;
  countryCode?: string;
  source: "dict" | "fallback-validated";
};

export type TripIntent = {
  locations: {
    detected: LocalPlaceDetected[];
    resolved: DetectedLocation[];
  };
  months: string[];
  monthsFull: string[];
  season?: SeasonName;
  keywords: { activities: string[]; vibes: string[] };
};

export async function parseTripIntent(input: string, signal?: AbortSignal): Promise<TripIntent> {
  const text = input.trim();
  const lower = text.toLowerCase();

  const mentions = detectPlaceMentions(text);
  const dictCountries = mentions.filter(m => m.kind === "country" && m.source === "dict");
  const singleCountryName = dictCountries.length === 1 ? dictCountries[0].phrase : undefined;
  const singleIso = singleCountryName ? isoFromCountryName(singleCountryName) : undefined;

  const validated = await validateFallbackMentions(
    mentions,
    singleCountryName ? { name: singleCountryName, iso: singleIso } : undefined,
    signal
  );

  const resolved = await detectLocationsWithNominatim(text, { signal });

  const months = parseMonthsWithRanges(text);
  const season = detectSeason(text);
  const monthsFull = months.map((key) => MONTH_FULL[key]).filter((name): name is string => Boolean(name));

  const keywordRegex = (k: string) => new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i");
  const activities = ACTIVITY_KEYWORDS.filter(k => keywordRegex(k).test(text));
  const vibes = VIBE_KEYWORDS.filter(k => keywordRegex(k).test(text));

  const byKey = new Set<string>();
  const detected: LocalPlaceDetected[] = [];
  for (const v of validated) {
    const cityRef = (v.kind === "city" ? v.city : undefined) || v.country || v.text;
    const key = `${v.kind}:${(cityRef || "").toLowerCase()}|${(v.countryCode || v.country || "").toLowerCase()}`;
    if (byKey.has(key)) continue;
    byKey.add(key);
    detected.push(v);
  }

  const intent: TripIntent = {
    locations: { detected, resolved },
    months,
    monthsFull,
    season,
    keywords: { activities, vibes },
  };

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[parseTripIntent] intent:", intent);
  }

  return intent;
}

export function logTripIntent(intent: TripIntent, raw: string) {
  if ((import.meta as any).env?.VITE_DEBUG_INTENT === '1') {
    /* eslint-disable no-console */
    console.group("%cTripIntent (Local)", "background:#225; color:#fff; padding:2px 6px; border-radius:4px;");
    console.log("Raw:", raw);

    console.group("Locations (Detected)");
    if (intent.locations.detected.length) {
      console.table(intent.locations.detected.map(d => ({
        kind: d.kind,
        text: d.text,
        city: d.city ?? '-',
        country: d.country ?? '-',
        code: d.countryCode ?? '-',
        source: d.source,
      })));
    } else {
      console.log("- none -");
    }
    console.groupEnd();

    console.group("Locations (Resolved)");
    if (intent.locations.resolved.length) {
      console.table(intent.locations.resolved.map(l => ({
        label: l.label,
        city: l.city ?? "-",
        country: l.country ?? "-",
        code: l.countryCode ?? "-",
        lat: l.lat?.toFixed(4) ?? "-",
        lon: l.lon?.toFixed(4) ?? "-",
        score: l.score.toFixed(2)
      })));
    } else {
      console.log("- none -");
    }
    console.groupEnd();

    console.group("Time");
    console.log("Months:", intent.months.length ? intent.months.join(", ") : "-");
    console.log("Season:", intent.season ?? "-");
    console.groupEnd();

    console.group("Keywords");
    console.log("Activities:", intent.keywords.activities.join(", ") || "-");
    console.log("Vibes:", intent.keywords.vibes.join(", ") || "-");
    console.groupEnd();

    console.groupEnd();
    /* eslint-enable no-console */
  }
}
