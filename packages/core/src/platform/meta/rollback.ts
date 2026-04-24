import type { CleanupResult } from "../types.js";

export type MetaResourceType = "campaign" | "adset" | "ad" | "creative";

export interface CreatedResource {
  type: MetaResourceType;
  id: string;
}

export interface RollbackInput {
  created: CreatedResource[];
  deleter: (type: MetaResourceType, id: string) => Promise<void>;
}

export async function executeRollback(input: RollbackInput): Promise<CleanupResult> {
  const { created, deleter } = input;
  const reversed = [...created].reverse();
  const deleted: string[] = [];
  const orphans: CleanupResult["orphans"] = [];

  for (const resource of reversed) {
    try {
      await deleter(resource.type, resource.id);
      deleted.push(resource.id);
    } catch (err) {
      console.error(`[meta/rollback] failed to delete ${resource.type} ${resource.id}:`, err);
      orphans.push({ type: resource.type, id: resource.id });
    }
  }

  return { deleted, orphans };
}

export async function appendOrphansToDisk(
  orphans: CleanupResult["orphans"],
  writeFn: (path: string, data: unknown) => Promise<void>,
  readFn: <T>(path: string) => Promise<T | null>,
): Promise<void> {
  if (orphans.length === 0) return;
  const existing = (await readFn<CleanupResult["orphans"]>("data/orphans.json")) ?? [];
  await writeFn("data/orphans.json", [...existing, ...orphans]);
}
