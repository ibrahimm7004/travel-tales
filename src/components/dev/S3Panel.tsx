import { useEffect, useMemo, useState } from "react";
import { isS3Debug } from "@/lib/debugFlags";
import type { S3HeadResponse, S3ListItem, S3ListResponse } from "@/types/s3";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toCSV, copy } from "@/lib/csv";

type Props = { albumPrefix?: string; sampleKeys?: string[] };

export default function S3Panel({ albumPrefix, sampleKeys }: Props) {
  const enabled = isS3Debug();
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const [prefix, setPrefix] = useState(albumPrefix || "");
  const [items, setItems] = useState<S3ListItem[]>([]);
  const [error, setError] = useState<string>("");
  const [mock, setMock] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => { if (albumPrefix && !prefix) setPrefix(albumPrefix); }, [albumPrefix]);

  const firstImages = useMemo(() => items.filter(i => /\.(jpe?g|png|webp)$/i.test(i.key)).slice(0, 3), [items]);

  if (!enabled) return null;

  async function safeFetch(url: string) {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
    }
    return res.json();
  }

  const onPing = async () => {
    setError(""); setLoading("ping");
    try {
      const data = await safeFetch(`${base}/debug/s3/ping`);
      setMock(Boolean(data?.mock));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(null); }
  };

  const onList = async () => {
    setError(""); setLoading("list");
    try {
      const u = new URL(`${base}/debug/s3/list`);
      u.searchParams.set("prefix", prefix || "");
      const data: S3ListResponse = await safeFetch(u.toString());
      setMock(Boolean(data?.mock));
      setItems(data.items || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(null); }
  };

  const onHeadFirst5 = async () => {
    setError(""); setLoading("head");
    try {
      const keys = (items.length ? items : (sampleKeys || []).map(k => ({ key: k, size: 0, lastModified: null } as S3ListItem)))
        .slice(0, 5)
        .map(i => i.key);
      for (const key of keys) {
        const u = new URL(`${base}/debug/s3/head`);
        u.searchParams.set("key", key);
        const data: S3HeadResponse = await safeFetch(u.toString());
        if (data?.mock) setMock(true);
        // no-op; could display per-row details later
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(null); }
  };

  const onCopyCsv = async () => {
    const rows = items.map(i => ({ key: i.key, url: `${base}/debug/s3/signed-get?key=${encodeURIComponent(i.key)}` }));
    await copy(toCSV(rows));
  };

  const [thumbUrls, setThumbUrls] = useState<{ key: string; url: string }[]>([]);
  const onPreview = async () => {
    setError(""); setLoading("preview");
    try {
      const keys = (items.length ? items : (sampleKeys || []).map(k => ({ key: k, size: 0, lastModified: null } as S3ListItem)))
        .filter(i => /\.(jpe?g|png|webp)$/i.test(i.key))
        .slice(0, 3)
        .map(i => i.key);
      const urls: { key: string; url: string }[] = [];
      for (const key of keys) {
        const u = new URL(`${base}/debug/s3/signed-get`);
        u.searchParams.set("key", key);
        u.searchParams.set("expires", "300");
        const data = await safeFetch(u.toString());
        if (data?.mock) setMock(true);
        if (data?.url) urls.push({ key, url: data.url });
      }
      setThumbUrls(urls);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(null); }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">S3 Debug</CardTitle>
        <div className="flex items-center gap-2">
          {mock ? <Badge variant="secondary">Mock S3 mode</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="mb-3 text-sm text-red-700 bg-red-100 border border-red-200 rounded px-2 py-1">{error}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Input placeholder="prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} className="w-64" />
          <Button variant="secondary" onClick={onPing} disabled={loading !== null}>Ping</Button>
          <Button onClick={onList} disabled={!prefix || loading !== null}>List</Button>
          <Button onClick={onHeadFirst5} disabled={loading !== null}>HEAD First 5</Button>
          <Button onClick={onPreview} disabled={loading !== null}>Preview Thumbs (3)</Button>
          <Button variant="outline" onClick={onCopyCsv} disabled={!items.length}>Copy Signed URLs (CSV)</Button>
        </div>
        <div className="text-xs text-muted-foreground mb-2">{items.length} items</div>
        {items.length ? (
          <div className="overflow-auto max-h-60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">Key</th>
                  <th className="px-2 py-1">Size</th>
                  <th className="px-2 py-1">Last Modified</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 20).map((i) => (
                  <tr key={i.key} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap max-w-[420px] overflow-hidden text-ellipsis">{i.key}</td>
                    <td className="px-2 py-1">{i.size}</td>
                    <td className="px-2 py-1">{i.lastModified || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {thumbUrls.length ? (
          <div className="mt-3 flex items-center gap-2">
            {thumbUrls.map((t) => (
              <img key={t.key} src={t.url} alt={t.key} className="h-20 w-20 object-cover rounded border" />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}





