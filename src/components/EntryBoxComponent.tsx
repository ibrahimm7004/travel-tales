import "@/styles/entrybox-orbit.css";
import { Send } from "lucide-react";

export type EntryBoxOrbitProps = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  rows?: number;
  className?: string;
};

export const EntryBoxOrbit = ({
  value,
  onChange,
  onSend,
  placeholder = "Tell us about your trip",
  rows = 4,
  className = "",
}: EntryBoxOrbitProps) => {
  return (
    <div className={`tt-idea-card ${className}`}>
      <div className="tt-gradient-border">
        <div className="tt-gradient-outer"></div>
        <div className="tt-field-wrapper">
          <textarea
            className="tt-textarea"
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label="Trip description"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <button
            type="button"
            aria-label="Send"
            onClick={onSend}
            className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-secondary text-secondary-foreground shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center hover:scale-105"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
