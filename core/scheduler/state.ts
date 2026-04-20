import { readJson, writeJson } from "../storage.js";
import type { Cadence } from "./cadence.js";

export const WORKER_STATE_PATH = "data/worker-state.json";

export interface WorkerState {
  lastCollect: string | null;
  lastAnalyze: string | null;
}

export interface CatchupDecision {
  collect: boolean;
  analyze: boolean;
}

export interface SchedulerDeps {
  collectDailyReports: () => Promise<unknown>;
  generateWeeklyAnalysis: () => Promise<unknown>;
  runImprovementCycle: () => Promise<unknown>;
}

function ageOrInfinity(iso: string | null, now: number): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : now - t;
}

export function shouldCatchup(
  state: WorkerState,
  cadence: Cadence,
  now: number,
): CatchupDecision {
  const collectAge = ageOrInfinity(state.lastCollect, now);
  const analyzeAge = ageOrInfinity(state.lastAnalyze, now);
  return {
    collect: collectAge >= cadence.catchupCollectMs,
    analyze: analyzeAge >= cadence.catchupAnalyzeMs,
  };
}

// readJson returns null for both missing and corrupt JSON; both treated as first-boot.
async function readState(): Promise<WorkerState> {
  return (
    (await readJson<WorkerState>(WORKER_STATE_PATH)) ?? {
      lastCollect: null,
      lastAnalyze: null,
    }
  );
}

export async function updateStateField(
  field: keyof WorkerState,
): Promise<void> {
  const state = await readState();
  state[field] = new Date().toISOString();
  await writeJson(WORKER_STATE_PATH, state);
}

export async function runCatchupIfNeeded(
  deps: SchedulerDeps,
  cadence: Cadence,
): Promise<void> {
  const state = await readState();
  const decision = shouldCatchup(state, cadence, Date.now());

  if (decision.collect) {
    try {
      await deps.collectDailyReports();
      await updateStateField("lastCollect");
    } catch (e) {
      console.error("[scheduler] catchup collect failed:", e);
    }
  }
  if (decision.analyze) {
    try {
      await deps.generateWeeklyAnalysis();
      await deps.runImprovementCycle();
      await updateStateField("lastAnalyze");
    } catch (e) {
      console.error("[scheduler] catchup analyze failed:", e);
    }
  }
}
