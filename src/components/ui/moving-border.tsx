import * as React from "react";
import { cn } from "@/lib/utils";

type MovingBorderProps = {
  as?: React.ElementType;
  borderRadius?: string;     // e.g., "1.5rem"
  duration?: number;         // ms (1000 = ~2× faster feel)
  className?: string;        // inner surface
  containerClassName?: string;
  borderClassName?: string;  // allow opacity tweaks only
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/**
 * Thin "ribbon" that travels around the border using stroke-dash animation.
 * No masks, no gradient fills, no full-rect rotations.
 */
export function Button({
  as: Comp = "div",
  borderRadius = "1.5rem",
  duration = 1000,
  className,
  containerClassName,
  borderClassName,
  style,
  children,
}: MovingBorderProps) {
  const gradId = React.useId(); // unique per instance

  // We normalize path length to 1000 to make CSS animation simple.
  const PATH_LEN = 1000;        // matches keyframes mb-trace (dashoffset ±1000)
  const DASH = 160;             // visible ribbon length along perimeter
  const GAP = PATH_LEN - DASH;  // the rest is invisible gap

  return (
    <Comp className={cn("relative overflow-hidden rounded-[inherit]", containerClassName)} style={{ borderRadius, ...style }}>
      <svg
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", borderClassName)}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ zIndex: 0, borderRadius }}
      >
        <defs>
          <linearGradient id={`mb-grad-${gradId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity="0.15" />
            <stop offset="10%"  stopColor="hsl(var(--primary))" stopOpacity="1" />
            <stop offset="90%"  stopColor="hsl(var(--primary))" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.15" />
          </linearGradient>
        </defs>

        <g
          style={{
            transformOrigin: "50% 50%",
            animation: `mb-trace ${Math.max(100, duration)}ms linear infinite`,
          }}
        >
          <rect
            x="1.25"
            y="1.25"
            width="97.5"
            height="97.5"
            rx="12"
            ry="12"
            fill="none"
            stroke={`url(#mb-grad-${gradId})`}
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={PATH_LEN}
            strokeDasharray={`160 840`}
          />
        </g>
      </svg>

      <div
        className={cn("relative rounded-[inherit]", className)}
        style={{ borderRadius, zIndex: 1 }}
      >
        {children}
      </div>
    </Comp>
  );
}
