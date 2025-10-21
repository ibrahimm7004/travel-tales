import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import S3Panel from "@/components/dev/S3Panel";

export default function ProcessingPage() {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);
  const [albumPrefix, setAlbumPrefix] = useState<string | undefined>(undefined);
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem("lastUpload");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setCount(Number(parsed?.count || 0));
        const ks = Array.isArray(parsed?.keys) ? parsed.keys as string[] : [];
        setKeys(ks);
        if (ks.length) {
          const prefix = ks[0].split("/").slice(0, -1).join("/") + "/";
          setAlbumPrefix(prefix);
        }
      } catch {}
    }
  }, []);

  return (
    <div data-testid="processing-page" className="min-h-screen vintage-bg flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        <div className="bg-card/90 rounded-2xl shadow-vintage p-10 border border-border text-center">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 border border-[#6B8E23] bg-[#F9F9F5] text-[#4F6420] text-sm mb-6" data-testid="processing-count">
            Uploaded {count} photos
          </div>
          <h2 className="text-2xl font-semibold mb-2" style={{ color: "#4F6420", fontFamily: "Lato, sans-serif" }}>AI Processing Coming Soon</h2>
          <p className="text-[#4F6420]/80 mb-6">We’re preparing your images for curation and storytelling.</p>
          <button onClick={() => navigate("/home")} className="inline-flex items-center justify-center px-5 py-2 rounded-full border border-[#6B8E23] bg-white text-[#4F6420] hover:bg-[#E8EBD1]">
            Back to Home
          </button>
        </div>
        {/* Hidden S3 debug panel */}
        <div className="mt-4">
          <S3Panel albumPrefix={albumPrefix} sampleKeys={keys.slice(-5)} />
        </div>
      </div>
    </div>
  );
}



