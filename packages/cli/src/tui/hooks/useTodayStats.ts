import { useCallback, useEffect, useState } from "react";
import { stat } from "fs/promises";
import { listJson, readJson } from "@ad-ai/core/storage.js";
import type { Creative } from "@ad-ai/core/types.js";

export interface TodayStats { todayCount: number; refresh: () => void; bump: () => void; }

export function useTodayStats(): TodayStats {
  const [todayCount, setTodayCount] = useState(0);

  const compute = useCallback(async () => {
    const paths = await listJson("data/creatives");
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    let count = 0;
    for (const p of paths) {
      const c = await readJson<Creative>(p);
      if (!c) continue;
      if (c.status !== "approved" && c.status !== "edited") continue;
      const s = await stat(p);
      if (s.mtimeMs >= startOfToday.getTime()) count++;
    }
    setTodayCount(count);
  }, []);

  useEffect(() => { void compute(); }, [compute]);

  return {
    todayCount,
    refresh: () => { void compute(); },
    bump: () => setTodayCount((n) => n + 1),
  };
}
