import { motion } from "framer-motion";

export default function OliveLoader({ subline, testId }: { subline?: string; testId?: string }) {
  const dots = [0, 1, 2, 3];
  return (
    <div data-testid={testId || "upload-loader"} className="bg-[#F9F9F5] rounded-2xl border border-[#A7B580] shadow-inner p-8 flex flex-col items-center justify-center">
      <div className="flex gap-3">
        {dots.map((i) => (
          <motion.span
            key={i}
            className="w-3 h-3 rounded-full bg-[#6B8E23]"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
      {subline && <p className="mt-4 text-sm text-[#4F6420]/80">{subline}</p>}
    </div>
  );
}







