// src/components/FilmStripLoader.tsx
import React from "react";

/**
 * FilmStripLoader
 * A minimal, self-contained loader whose "sprocket holes" scroll left infinitely.
 * Uses a radial-gradient background layer whose background-position is animated,
 * creating a seamless tape effect (no visible start/end of dots).
 */
export function FilmStripLoader({
  label = "Developing your memories…",
}: {
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      {/* Decorative strip */}
      <div
        aria-hidden="true"
        className="tt-filmstrip"
        // Width/height kept modest; responsive-safe in the loader context
        style={{ width: 260, height: 18, borderRadius: 6 }}
      />
      {/* Accessible text for screen readers and subtle caption for sighted users */}
      <span className="italic opacity-70 text-[15px]">{label}</span>

      {/* Scoped styles (class names are namespaced to avoid collisions) */}
      <style>{`
        .tt-filmstrip {
          /* Theme-ish colors: cocoa strip with cream sprocket holes */
          --tt-strip: #6b4f3f;   /* film base */
          --tt-hole:  #efe7d6;   /* sprocket hole color */

          /* Base strip */
          background:
            /* layer 1: sprocket holes as a repeating radial gradient */
            radial-gradient(circle, var(--tt-hole) 0 3px, transparent 3.2px) 0 50% / 24px 100% repeat-x,
            /* layer 0: solid strip base */
            linear-gradient(var(--tt-strip), var(--tt-strip));

          /* Endless left-ward motion by shifting background-position of layer 1 */
          animation: tt-sprockets 1.1s linear infinite;
          box-shadow: 0 1px 0 rgba(0,0,0,0.08) inset, 0 2px 6px rgba(0,0,0,0.12);
        }

        @keyframes tt-sprockets {
          from { background-position: 0 50%, 0 0; }
          to   { background-position: -24px 50%, 0 0; }
        }

        /* Respect user motion preferences */
        @media (prefers-reduced-motion: reduce) {
          .tt-filmstrip {
            animation-duration: 0.001s;
            animation-iteration-count: 1;
          }
        }
      `}</style>
    </div>
  );
}
