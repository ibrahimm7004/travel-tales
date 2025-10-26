import { detectPlaceMentions, detectCountryBias, isoFromCountryName } from "./detect_places";

export type OSMPlace = {
  display_name: string;
  lat: string;
  lon: string;
  importance?: number;
  class?: string;
  type?: string;
  address?: Record<string, string>;
};

export type DetectedLocation = {
  label: string;
  kind: "country" | "city";
  city?: string;
  country?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
  source: "nominatim";
  score: number;
  rawType?: string;
  rawClass?: string;
};

const USER_AGENT = "TravelTales/1.0 (contact@example.com)";
const DEBUG = (import.meta as any).env?.VITE_DEBUG_INTENT === '1';

function debug(...args: any[]) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[intent-debug]", ...args);
  }
}

const CITY_TYPES = new Set([
  "city","town","village","hamlet","municipality","locality"
]);

function toDetected(d: OSMPlace): DetectedLocation | null {
  const address = d.address || {};
  const isCountry = d.type === "country";
  const isCityish = CITY_TYPES.has((d.type ?? "").toLowerCase());
  if (!isCountry && !isCityish) return null;

  const city = (address as any).city
    || (address as any).town
    || (address as any).village
    || (address as any).hamlet
    || (address as any).municipality
    || (address as any).locality;
  const country = (address as any).country;
  const countryCode = (address as any).country_code ? String((address as any).country_code).toLowerCase() : undefined;

  const label = isCountry
    ? (country || d.display_name)
    : [city, country].filter(Boolean).join(", ") || d.display_name;

  return {
    label,
    kind: isCountry ? "country" : "city",
    city: isCountry ? undefined : (city || undefined),
    country: country || undefined,
    countryCode,
    lat: d.lat ? Number(d.lat) : undefined,
    lon: d.lon ? Number(d.lon) : undefined,
    source: "nominatim",
    score: typeof d.importance === "number" ? d.importance : 0.3,
    rawType: d.type,
    rawClass: d.class,
  };
}

async function nominatimSearch(
  q: string,
  options?: { countryCodes?: string[]; signal?: AbortSignal; limit?: number }
): Promise<OSMPlace[]> {
  const params = new URLSearchParams({
    format: "jsonv2",
    q,
    addressdetails: "1",
    extratags: "0",
    namedetails: "0",
  });

  const limit = Math.max(1, Math.min(10, options?.limit ?? 6));
  params.set("limit", String(limit));

  if (options?.countryCodes && options.countryCodes.length) {
    params.set("countrycodes", options.countryCodes.join(","));
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  let attempt = 0;
  let delay = 300;
  while (attempt < 3) {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": USER_AGENT },
      signal: options?.signal,
    } as RequestInit);
    if (res.ok) return (await res.json()) as OSMPlace[];
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      attempt += 1;
      continue;
    }
    throw new Error(`Nominatim error ${res.status}`);
  }
  return [];
}

const cache = new Map<string, DetectedLocation[]>();

function dedupe<T>(arr: T[], key: (x: T) => string) {
  const seen = new Set<string>();
  return arr.filter(item => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function detectLocationsWithNominatim(
  text: string,
  opts?: { signal?: AbortSignal; limit?: number; biasCountryCodes?: string[] }
): Promise<DetectedLocation[]> {
  const raw = text.trim();
  if (!raw) return [];

  let mentions = detectPlaceMentions(raw);
  if (!mentions.length) {
    mentions = [{ phrase: raw, kind: "city", source: "fallback" }];
  }

  const mentionedCodes = detectCountryBias(raw);
  const biasCodes = (opts?.biasCountryCodes || []).map(c => c.toLowerCase());
  const candidateCodes = mentionedCodes.length ? mentionedCodes : biasCodes;

  debug("mentions(final before OSM)", mentions.map(m => `${m.kind}:${m.phrase}`));

  const results: DetectedLocation[] = [];
  for (const m of mentions) {
    const phrase = m.phrase;
    const restrictCodes = m.kind === "country"
      ? undefined
      : (candidateCodes.length ? candidateCodes : undefined);

    const keyPart = restrictCodes && restrictCodes.length ? `::${restrictCodes.join(',')}` : "";
    const cacheKey = `${phrase}${keyPart}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey)!;
      if (cached.length) results.push(...cached);
      continue;
    }

    const desiredLimit = opts?.limit ?? 1;

    const data = await nominatimSearch(phrase, {
      countryCodes: restrictCodes,
      signal: opts?.signal,
      limit: desiredLimit,
    });

    const mapped = data
      .map(toDetected)
      .filter(Boolean) as DetectedLocation[];

    mapped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const limited = mapped.slice(0, desiredLimit);
    cache.set(cacheKey, limited);
    results.push(...limited);

    await new Promise(r => setTimeout(r, 120));
  }

  const deduped = dedupe(results, x => (
    x.kind === "country"
      ? `${(x.country || x.label || "").toLowerCase()}`
      : `${(x.city || x.label || "").toLowerCase()}|${(x.countryCode || x.country || "").toLowerCase()}`
  ));

  deduped.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  debug("final locations", deduped.map(d => d.label));
  return deduped;
}
