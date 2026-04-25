import { requireVoyageKey } from "../config/helpers.js";

export interface VoyageClient {
  embed(texts: string[]): Promise<number[][]>;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export function createVoyageClient(): VoyageClient {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const apiKey = requireVoyageKey();

      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: texts, model: "voyage-3-lite" }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Voyage API ${res.status}: ${text}`);
      }
      const data = (await res.json()) as VoyageResponse;
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      if (sorted.length !== texts.length) {
        throw new Error(
          `Voyage API returned ${sorted.length} embeddings for ${texts.length} inputs`,
        );
      }
      return sorted.map((d) => d.embedding);
    },
  };
}
