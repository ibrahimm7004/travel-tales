import { useEffect, useState } from "react";
import { isUploadDebugEnabled } from "@/lib/debug";

export default function UploadDebugPanel({ feed }: { feed: any[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "d") setOpen((o) => !o); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!import.meta.env.DEV || !isUploadDebugEnabled()) return null;
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", bottom: 16, left: 16, zIndex: 9999,
      maxHeight: "40vh", width: "min(520px, 90vw)", overflow: "auto",
      background: "#F9F9F5", border: "1px solid #A7B580", borderRadius: 12, padding: 12,
      boxShadow: "0 10px 30px rgba(0,0,0,0.1)", color: "#4F6420", fontFamily: "Lato, sans-serif"
    }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Upload Debug (press “D” to toggle)</div>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.3 }}>
        {JSON.stringify(feed.slice(-50), null, 2)}
      </pre>
    </div>
  );
}






