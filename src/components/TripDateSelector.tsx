import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];

export default function TripDateSelector({ isOpen, onClose, onSelect, defaultYear = new Date().getFullYear() }: TripDateSelectorProps) {
  const [step, setStep] = useState<"year" | "picker">("year");
  const [year, setYear] = useState<number>(defaultYear);
  const [activeTab, setActiveTab] = useState<"month" | "season">("month");
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep("year");
      setActiveTab("month");
      setRangeStart(null);
      setRangeEnd(null);
    }
  }, [isOpen]);

  const commitRangeIfReady = (startIdx: number | null, endIdx: number | null) => {
    if (startIdx === null) return;
    if (endIdx === null) return;
    const s = Math.min(startIdx, endIdx);
    const e = Math.max(startIdx, endIdx);
    const label = s === e ? `${MONTHS[s]} ${year}` : `${MONTHS[s]} – ${MONTHS[e]} ${year}`;
    onSelect(label);
    onClose();
  };

  const handleMonthClick = (idx: number) => {
    if (rangeStart === null) {
      setRangeStart(idx);
      setRangeEnd(null);
      return;
    }
    if (rangeEnd === null) {
      setRangeEnd(idx);
      commitRangeIfReady(rangeStart, idx);
      return;
    }
    // Restart selection when both already set
    setRangeStart(idx);
    setRangeEnd(null);
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
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>When in {year}?</h3>
              <div className="ml-auto" />
            </div>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
              <TabsList className="rounded-full bg-[#E8EBD1] p-1">
                <TabsTrigger value="month" className={`rounded-full data-[state=active]:bg-white data-[state=active]:text-[#4F6420]`}>Month</TabsTrigger>
                <TabsTrigger value="season" className={`rounded-full data-[state=active]:bg-white data-[state=active]:text-[#4F6420]`}>Season</TabsTrigger>
              </TabsList>
              <TabsContent value="month">
                <div data-testid="q2-month-range" className="grid grid-cols-3 gap-2 mt-3">
                  {MONTHS.map((m, idx) => {
                    const hasStart = rangeStart !== null;
                    const hasEnd = rangeEnd !== null;
                    const s = hasStart ? (rangeStart as number) : -1;
                    const e = hasEnd ? (rangeEnd as number) : -1;
                    const inRange = hasStart && hasEnd && idx >= Math.min(s, e) && idx <= Math.max(s, e);
                    const isStart = hasStart && idx === s;
                    const isEnd = hasEnd && idx === e;
                    const isActive = isStart || isEnd || inRange || (!hasEnd && hasStart && idx === s);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleMonthClick(idx)}
                        className={`px-3 py-2 text-sm rounded-xl border transition-colors text-left ${isActive ? "bg-[#E8EBD1] border-[#6B8E23]" : "bg-white border-[#A7B580] hover:bg-[#F4F6E8]"}`}
                        aria-pressed={isActive}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </TabsContent>
              <TabsContent value="season">
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {SEASONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => selectSeason(s)}
                      className="px-3 py-2 text-sm rounded-xl border bg-white border-[#A7B580] hover:bg-[#E8EBD1] text-left"
                    >
                      {s} {year}
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

