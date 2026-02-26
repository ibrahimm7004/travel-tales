import type { ReactNode } from "react";

export const RESULTS_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif';

type ResultsLayoutProps = {
  testId: string;
  title: string;
  albumId: string | null;
  children: ReactNode;
};

export function ResultsLayout({ testId, title, albumId, children }: ResultsLayoutProps) {
  return (
    <div
      data-testid={testId}
      className="min-h-screen vintage-bg flex items-center justify-center p-6"
      style={{ fontFamily: RESULTS_FONT_FAMILY }}
    >
      <div className="max-w-6xl w-full">
        <div className="bg-card/90 rounded-2xl shadow-vintage p-8 md:p-10 border border-border">
          <h1 className="text-4xl md:text-5xl font-semibold text-center mb-3 text-[#4F6420]">{title}</h1>
          <p className="text-center text-[#4F6420]/80 mb-6">Album: {albumId || "Not found"}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

