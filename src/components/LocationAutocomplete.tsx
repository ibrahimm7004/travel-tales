import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

type LocationAutocompleteProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

const MOCK_LOCATIONS = [
  "New York, USA",
  "Los Angeles, USA",
  "Paris, France",
  "London, UK",
  "Tokyo, Japan",
  "Osaka, Japan",
  "Kyoto, Japan",
  "Seoul, South Korea",
  "Shanghai, China",
  "Beijing, China",
  "Sydney, Australia",
  "Melbourne, Australia",
  "Auckland, New Zealand",
  "Toronto, Canada",
  "Vancouver, Canada",
  "Mexico City, Mexico",
  "Rio de Janeiro, Brazil",
  "Sao Paulo, Brazil",
  "Buenos Aires, Argentina",
  "Cape Town, South Africa",
  "Nairobi, Kenya",
  "Cairo, Egypt",
  "Marrakesh, Morocco",
  "Dubai, UAE",
  "Istanbul, Turkey",
  "Rome, Italy",
  "Milan, Italy",
  "Barcelona, Spain",
  "Madrid, Spain",
  "Lisbon, Portugal",
  "Berlin, Germany",
  "Munich, Germany",
  "Amsterdam, Netherlands",
  "Copenhagen, Denmark",
  "Stockholm, Sweden",
  "Helsinki, Finland",
  "Reykjavik, Iceland",
  "Bangkok, Thailand",
  "Bali, Indonesia",
  "Singapore",
  "Kuala Lumpur, Malaysia",
  "Hanoi, Vietnam",
  "Ho Chi Minh City, Vietnam",
  "Kathmandu, Nepal",
  "Delhi, India",
  "Mumbai, India",
  "Goa, India",
  "Zurich, Switzerland",
  "Geneva, Switzerland",
  "Athens, Greece",
];

type NominatimResult = {
  display_name: string;
  address?: Record<string, string>;
};

export default function LocationAutocomplete({ value, onChange, placeholder = "Start typing a location..." }: LocationAutocompleteProps) {
  const [query, setQuery] = useState<string>(value);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [apiResults, setApiResults] = useState<string[] | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastGoodResultsRef = useRef<string[] | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query || query.trim().length < 2) {
      setApiResults(null);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const params = new URLSearchParams({ format: "json", q: query, addressdetails: "1", limit: "8" });
        const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

        // Simple retry/backoff (handles 429 politely)
        let attempt = 0;
        let res: Response | null = null;
        let delay = 300;
        setIsLoading(true);
        while (attempt < 3) {
          res = await fetch(url, {
            headers: {
              "Accept": "application/json",
              "User-Agent": "TravelTales/1.0 (contact@example.com)",
            },
            signal: controller.signal,
          });
          if (res.ok) break;
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, delay));
            delay *= 2;
            attempt += 1;
            continue;
          }
          throw new Error("Nominatim error");
        }
        if (!res || !res.ok) throw new Error("Nominatim error");

        const data: NominatimResult[] = await res.json();
        const friendly = data.map((d) => formatDisplayName(d)).filter(Boolean) as string[];
        setApiResults(friendly.length > 0 ? friendly : null);
        if (friendly.length > 0) lastGoodResultsRef.current = friendly;
        setIsOffline(false);
      } catch (_e) {
        // Graceful fallback: use last good results or cached mock
        const fallback = lastGoodResultsRef.current && lastGoodResultsRef.current.length > 0 ? lastGoodResultsRef.current : null;
        setApiResults(fallback);
        setIsOffline(true);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const results = useMemo(() => {
    if (apiResults && query.trim()) return apiResults;
    if (!query.trim()) return MOCK_LOCATIONS.slice(0, 8);
    const q = query.toLowerCase();
    return MOCK_LOCATIONS.filter((loc) => loc.toLowerCase().includes(q)).slice(0, 8);
  }, [apiResults, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHighlightIndex(-1);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        setHighlightIndex(-1);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const commitSelection = (val: string) => {
    onChange(val);
    setQuery(val);
    setIsOpen(false);
    setHighlightIndex(-1);
  };

  return (
    <div ref={containerRef} data-testid="q1-location-autocomplete" className="card-default focus-within:ring-2 focus-within:ring-[#6B8E23]/30 hover:shadow-[0_4px_10px_rgba(107,142,35,0.20)] transition-all">
      <div className="flex items-center gap-3">
        <MapPin size={18} className="text-[#6B8E23]" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            onChange(e.target.value);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              setIsOpen(true);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (highlightIndex >= 0 && results[highlightIndex]) {
                e.preventDefault();
                commitSelection(results[highlightIndex]);
              }
            } else if (e.key === "Escape") {
              setIsOpen(false);
              setHighlightIndex(-1);
            }
          }}
          placeholder={placeholder}
          className="journal-input bg-transparent border-none focus:ring-0 focus:outline-none shadow-none flex-1"
          style={{ backgroundColor: "transparent" }}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls="location-autocomplete-list"
        />
        {isLoading && (
          <Loader2 className="w-4 h-4 text-[#6B8E23] animate-spin ml-auto" aria-hidden="true" />
        )}
      </div>
      <span className="sr-only" aria-live="polite">{isLoading ? "Searching…" : ""}</span>
      {isOpen && results.length > 0 && (
        <ul
          id="location-autocomplete-list"
          ref={listRef}
          role="listbox"
          className="mt-3 rounded-xl border border-[#A7B580] bg-[#F9F9F5] shadow-inner-md overflow-hidden"
        >
          {results.map((item, idx) => (
            <li
              key={item}
              role="option"
              aria-selected={idx === highlightIndex}
              className={`px-4 py-3 cursor-pointer border-b border-[#A7B580]/30 last:border-b-0 ${idx === highlightIndex ? "bg-[#E8EBD1]" : ""}`}
              onMouseEnter={() => setHighlightIndex(idx)}
              onMouseLeave={() => setHighlightIndex(-1)}
              onMouseDown={(e) => {
                e.preventDefault();
                commitSelection(item);
              }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDisplayName(d: NominatimResult): string {
  const a = d.address || {};
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || "";
  const state = a.state || a.region || "";
  const country = a.country || "";
  const parts = [city, state, country].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return d.display_name;
}


