import { useEffect, useState } from "react";
import * as fs from "fs";
import { listJson, readJson } from "../../../core/storage.js";
import type { VariantReport } from "../../../core/platform/types.js";

export interface UseReportsResult {
  reports: VariantReport[];
  loading: boolean;
  lastRefreshAt: number;
}

export function useReports(windowDays: 7 | 14 | 30): UseReportsResult {
  const [reports, setReports] = useState<VariantReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState(Date.now());

  const load = async () => {
    setLoading(true);
    const paths = (await listJson("data/reports")).filter((p) => !p.includes("weekly-analysis"));
    const cutoff = Date.now() - windowDays * 86_400_000;
    const accumulated: VariantReport[] = [];
    for (const p of paths) {
      const data = await readJson<VariantReport[]>(p);
      if (!data) continue;
      for (const r of data) {
        if (new Date(r.date).getTime() >= cutoff) accumulated.push(r);
      }
    }
    setReports(accumulated);
    setLastRefreshAt(Date.now());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    let w1: ReturnType<typeof fs.watch> | undefined;
    try {
      w1 = fs.watch("data/reports", { persistent: false }, () => { void load(); });
    } catch {
      // directory may not exist yet on fresh checkout; interval fallback will catch it
    }
    const fallback = setInterval(() => { void load(); }, 60_000);
    return () => { w1?.close(); clearInterval(fallback); };
  }, [windowDays]);

  return { reports, loading, lastRefreshAt };
}
