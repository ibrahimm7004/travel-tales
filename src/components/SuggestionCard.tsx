import { motion } from "framer-motion";
import { Check } from "lucide-react";

interface SuggestionCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  isSelected?: boolean;
  onClick: () => void;
  isLoading?: boolean;
}

export function SuggestionCard({ 
  title, 
  subtitle, 
  icon, 
  isSelected = false, 
  onClick,
  isLoading = false 
}: SuggestionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`suggestion-card ${isSelected ? 'selected' : ''} ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {icon && (
            <div className="icon text-primary">
              {icon}
            </div>
          )}
          <div className="text-left">
            <h3 className="font-medium text-foreground mb-1">{title}</h3>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        
        {isSelected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-primary"
          >
            <Check size={20} />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}