import { useState } from "react";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CustomInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onAddChip?: (value: string) => void;
  chips?: string[];
  onRemoveChip?: (index: number) => void;
  multiSelect?: boolean;
}

export function CustomInput({ 
  placeholder, 
  value, 
  onChange, 
  onAddChip,
  chips = [],
  onRemoveChip,
  multiSelect = false
}: CustomInputProps) {
  const [inputValue, setInputValue] = useState(value);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim() && onAddChip && multiSelect) {
      e.preventDefault();
      onAddChip(inputValue.trim());
      setInputValue('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    if (!multiSelect) {
      onChange(newValue);
    }
  };

  return (
    <div className="space-y-3">
      <div className="breathe">
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          className="journal-input"
        />
        {multiSelect && (
          <p className="text-xs text-muted-foreground mt-1">
            Press Enter to add, or select from suggestions above
          </p>
        )}
      </div>

      {multiSelect && chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence>
            {chips.map((chip, index) => (
              <motion.div
                key={`${chip}-${index}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="input-chip"
              >
                <span>{chip}</span>
                {onRemoveChip && (
                  <button
                    onClick={() => onRemoveChip(index)}
                    type="button"
                    className="ml-1 hover:text-destructive transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}