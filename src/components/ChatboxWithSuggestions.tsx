import { useState } from "react";
import { motion } from "framer-motion";
import { Send, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ChatboxWithSuggestionsProps {
  onSend: (message: string) => void;
  onRegenerate: () => void;
}

const suggestionTexts = [
  "I visited Italy this summer for my honeymoon with my fiancé, it was super romantic. I would like to preserve the most romantic and memorable pictures of the two of us as a newly married couple.",
  "Family trip to NYC with my kids, we visited all the tourist spots. I want to extract all family pictures at famous spots to put in my vacation journal."
];

export function ChatboxWithSuggestions({ onSend, onRegenerate }: ChatboxWithSuggestionsProps) {
  const [message, setMessage] = useState("");

  const MAX_PREVIEW_WORDS = 30;

  const getPreviewText = (text: string, maxWords: number) => {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + " ...";
  };

  const handleSend = () => {
    if (message.trim()) {
      onSend(message.trim());
      setMessage("");
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setMessage(suggestion);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Main Chatbox */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative"
      >
        <div className="relative bg-card rounded-2xl border border-border shadow-vintage overflow-hidden">
          {/* Enhanced Animated Border with Light Strip Effect */}
          <div 
            className="absolute -inset-[2px] rounded-2xl opacity-70 focus-within:opacity-100 transition-opacity duration-300"
            style={{
              background: `
                conic-gradient(
                  from 0deg,
                  transparent,
                  hsl(var(--primary)),
                  hsl(var(--primary) / 0.8),
                  hsl(var(--accent)),
                  hsl(var(--primary) / 0.8),
                  hsl(var(--primary)),
                  transparent,
                  transparent
                )
              `,
              animation: 'light-strip 3s linear infinite',
              zIndex: -1
            }}
          />
          <div 
            className="absolute -inset-[1px] rounded-2xl bg-card"
            style={{ zIndex: -1 }}
          />
          
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Tell us about your trip"
            className="w-full bg-transparent border-0 rounded-2xl px-6 py-4 pr-16 text-foreground placeholder:text-muted-foreground placeholder:italic font-sans text-base leading-relaxed resize-none outline-none transition-all duration-200 focus:scale-[1.01]"
            rows={4}
          />
          
          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!message.trim()}
            className="absolute bottom-4 right-4 w-10 h-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center transition-all duration-200 transform-gpu disabled:opacity-50 disabled:cursor-not-allowed hover:scale-110 active:scale-95 shadow-soft hover:shadow-vintage"
          >
            <Send size={20} />
          </button>
        </div>
      </motion.div>

      {/* Suggestion Cards with Header - no universal parent Card */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <div className="cards-wrapper mt-8 md:mt-10 max-w-3xl mx-auto rounded-xl border border-border bg-white text-foreground shadow-soft p-3 md:p-4">
        <div className="space-y-2">
          {/* Wide header card */}
          <Card className="border-border bg-card shadow-soft hover:shadow-vintage transition-all duration-200">
            <CardContent className="px-4 py-2.5 md:px-5 md:py-3 min-h-14 flex items-center justify-between gap-3">
              <h3 className="font-serif text-sm md:text-base font-semibold text-foreground">
                Or try one of these examples:
              </h3>
              <button
                onClick={onRegenerate}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-primary border border-border hover:border-primary/50 rounded-lg bg-card hover:bg-primary/5 transition-all duration-200 font-medium"
                title="Regenerate suggestions"
              >
                <RotateCcw size={16} />
                <span>Regenerate</span>
              </button>
            </CardContent>
          </Card>

          {/* Suggestion row */}
          <div className="suggestion-row grid grid-cols-1 md:grid-cols-2 gap-3">
            {suggestionTexts.map((suggestion, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.3 + (index * 0.1) }}
              >
                <Card
                  onClick={() => handleSuggestionClick(suggestion)}
                  className={`group cursor-pointer transition-all duration-300 transform-gpu shadow-soft hover:shadow-vintage hover:-translate-y-1 hover:scale-[1.02] hover:border-primary/40 hover:bg-primary/5 ${
                    message === suggestion ? 'border-primary bg-primary/10' : 'border-border bg-card'
                  }`}
                >
                  <CardContent className="p-4 md:p-5 relative overflow-hidden h-36 flex items-center">
                    {/* Shimmer effect */}
                    <div 
                      className="absolute top-0 -left-full w-full h-full opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:left-full"
                      style={{
                        background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.1), transparent)'
                      }}
                    />

                    <p className="text-foreground text-sm leading-snug relative z-10">
                      {getPreviewText(suggestion, MAX_PREVIEW_WORDS)}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
          </div>
        </div>
      </motion.div>

    </div>
  );
}