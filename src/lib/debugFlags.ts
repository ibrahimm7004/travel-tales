export const isS3Debug = (): boolean => {
  if ((import.meta as any)?.env?.VITE_UPLOAD_DEBUG === "1") return true;
  const p = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const val = p?.get("debug");
  return val ? (val.split(",").includes("s3")) : false;
};





