import { useEffect, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatePresence, motion } from "framer-motion";
import { InstructionsBar } from "@/components/InstructionsBar";

type TripDateSelectorProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (label: string) => void;
  defaultYear?: number;
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1980 + 1 }, (_, i) => 1980 + i).reverse();
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];

export default function TripDateSelector({ isOpen, onClose, onSelect, defaultYear = new Date().getFullYear() }: TripDateSelectorProps) {
  const [step, setStep] = useState<"year" | "picker">("year");
  const [year, setYear] = useState<number>(defaultYear);
  const [activeTab, setActiveTab] = useState<"month" | "season">("month");
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [startYear, setStartYear] = useState<number | null>(null);
  const [endYear, setEndYear] = useState<number | null>(null);
  const [monthStage, setMonthStage] = useState<"start" | "end">("start");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep("year");
      setActiveTab("month");
      setRangeStart(null);
      setRangeEnd(null);
      setStartYear(null);
      setEndYear(null);
      setMonthStage("start");
      setHoverIdx(null);
    }
  }, [isOpen]);

  const commitRangeIfReady = (startIdx: number | null, endIdx: number | null, yStart: number | null, yEnd: number | null) => {
    if (startIdx === null) return;
    if (endIdx === null) return;
    let ys = yStart ?? year;
    let ye = yEnd ?? year;
    let sIdx = startIdx;
    let eIdx = endIdx;
    // Ensure chronological order across years
    if (ys > ye || (ys === ye && sIdx > eIdx)) {
      const tmpY = ys; ys = ye; ye = tmpY;
      const tmpI = sIdx; sIdx = eIdx; eIdx = tmpI;
    }
    let label = "";
    if (ys === ye) {
      const s = Math.min(sIdx, eIdx);
      const e = Math.max(sIdx, eIdx);
      label = s === e ? `${MONTHS_ABBR[s]} ${ys}` : `${MONTHS_ABBR[s]} – ${MONTHS_ABBR[e]} ${ys}`;
    } else {
      label = `${MONTHS_ABBR[sIdx]} ${ys} – ${MONTHS_ABBR[eIdx]} ${ye}`;
    }
    onSelect(label);
    onClose();
  };

  const handleMonthClick = (idx: number) => {
    if (monthStage === "start") {
      setRangeStart(idx);
      setRangeEnd(null);
      setStartYear(year);
      setEndYear(null);
      setMonthStage("end");
      return;
    }
    const startIdx = rangeStart ?? idx;
    const endIdx = idx;
    setEndYear(year);
    commitRangeIfReady(startIdx, endIdx, startYear ?? year, year);
  };

  const selectSeason = (s: string) => {
    onSelect(`${s} ${year}`);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="q2-date-dialog" className="bg-[#F9F9F5] rounded-2xl p-5 md:p-6 border border-[#A7B580] shadow-vintage">
        {step === "year" ? (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>Select a year</h3>
            <div className="h-64 overflow-y-auto rounded-xl border border-[#A7B580] bg-white">
              <ul>
                {YEARS.map((y) => (
                  <li key={y}>
                    <button
                      className={`w-full text-left px-4 py-3 hover:bg-[#E8EBD1] ${y === year ? "bg-[#E8EBD1]" : ""}`}
                      onClick={() => { setYear(y); setStep("picker"); }}
                    >
                      {y}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>
                {`When in ${year}?`}
              </h3>
              {activeTab === "month" && (
                <div className="flex flex-col items-end justify-center text-right">
                  <AnimatePresence initial={false}>
                    {monthStage === "start" && (
                      <motion.div key="instr-start" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                        <InstructionsBar className="mt-0" state="current" label="Select start month" />
                      </motion.div>
                    )}
                    {monthStage === "end" && rangeStart !== null && (
                      <>
                        <motion.div key="instr-done-start" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                          <InstructionsBar state="done" label="Select start month" detail={`Start: ${MONTHS[rangeStart]}`} />
                        </motion.div>
                        <motion.div key="instr-current-end" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-1">
                          <InstructionsBar state="current" label="Select end month" />
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
              <TabsList className="rounded-full bg-[#E8EBD1] p-1">
                <TabsTrigger value="month" className={`rounded-full data-[state=active]:bg-white data-[state=active]:text-[#4F6420]`}>Month</TabsTrigger>
                <TabsTrigger value="season" className={`rounded-full data-[state=active]:bg-white data-[state=active]:text-[#4F6420]`}>Season</TabsTrigger>
              </TabsList>
              <TabsContent value="month">
                <div data-testid="q2-month-grid" className="grid grid-cols-3 gap-2 mt-4">
                  {MONTHS.map((m, idx) => {
                    const hasStart = rangeStart !== null;
                    const s = hasStart ? (rangeStart as number) : -1;
                    let isActive = false;
                    if (monthStage === "start") {
                      isActive = hasStart && startYear === year && idx === s;
                    } else if (hasStart) {
                      if ((startYear ?? year) === year) {
                        const hover = hoverIdx ?? s;
                        const lo = Math.min(s, hover);
                        const hi = Math.max(s, hover);
                        isActive = idx >= lo && idx <= hi;
                      } else if ((startYear ?? year) < year) {
                        const hover = hoverIdx ?? 0;
                        isActive = idx >= 0 && idx <= hover;
                      }
                    }
                    return (
                      <button
                        key={m}
                        type="button"
                        onMouseEnter={() => { if (monthStage === "end") { setHoverIdx(idx); } }}
                        onMouseLeave={() => { if (monthStage === "end") { setHoverIdx(null); } }}
                        onClick={() => handleMonthClick(idx)}
                        className={`px-3 py-2 text-sm rounded-xl border transition-colors text-left ${isActive ? "bg-[#E8EBD1] border-[#6B8E23]" : "bg-white border-[#A7B580] hover:bg-[#F4F6E8]"}`}
                        aria-pressed={isActive}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    aria-label="Previous year"
                    onClick={() => setYear((y) => y - 1)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#E8EBD1] text-[#4F6420] hover:bg-[#dfe4c9] border border-[#A7B580]"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next year"
                    onClick={() => setYear((y) => y + 1)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#E8EBD1] text-[#4F6420] hover:bg-[#dfe4c9] border border-[#A7B580]"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </TabsContent>
              <TabsContent value="season">
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {SEASONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => selectSeason(s)}
                      className="px-3 py-2 text-sm rounded-xl border bg-white border-[#A8B580] hover:bg-[#E8EBD1] text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

