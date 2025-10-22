export function isUploadDebugEnabled(): boolean {
  const flag = (import.meta.env.VITE_UPLOAD_DEBUG || "false").toString().toLowerCase() === "true";
  const qp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  return flag || (qp?.get("debug") === "upload");
}

export function maskUrl(u: string): string {
  try {
    const url = new URL(u);
    url.search = url.search ? "?<masked>" : "";
    return url.toString();
  } catch {
    return u;
  }
}






