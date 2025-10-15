import { motion } from "framer-motion";
import React from "react";

type PromptSectionProps = React.PropsWithChildren<{
  className?: string;
}>;

export default function PromptSection({ className = "", children }: PromptSectionProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`prompt-section ${className}`}
    >
      {children}
    </motion.section>
  );
}

