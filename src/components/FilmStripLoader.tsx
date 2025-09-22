import { cn } from "@/lib/utils";

interface FilmStripLoaderProps {
  className?: string;
}

export function FilmStripLoader({ className }: FilmStripLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="film-strip" />
      <p className="text-sm text-muted-foreground font-serif italic animate-pulse">
        Developing your memories...
      </p>
    </div>
  );
}