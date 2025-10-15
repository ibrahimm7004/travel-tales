import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

type FreeTextCardProps = {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
};

export default function FreeTextCard({ placeholder, value, onChange }: FreeTextCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-default"
    >
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="journal-input border-[#A7B580]"
        style={{ backgroundColor: "white" }}
      />
    </motion.div>
  );
}

