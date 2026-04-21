import type { CreativesDb } from "./db.js";
import type { WinnerCreative } from "./types.js";

function encodeEmbedding(vec: number[]): Buffer {
  const arr = new Float32Array(vec);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function decodeEmbedding(buf: Buffer): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f);
}

interface WinnerRow {
  id: string;
  creative_id: string;
  product_category: string | null;
  product_tags: string;
  product_description: string;
  headline: string;
  body: string;
  cta: string;
  variant_label: string;
  embedding_product: Buffer;
  embedding_copy: Buffer;
  qualified_at: string;
  impressions: number;
  inline_link_click_ctr: number;
}

function rowToWinner(row: WinnerRow): WinnerCreative {
  return {
    id: row.id,
    creativeId: row.creative_id,
    productCategory: row.product_category,
    productTags: JSON.parse(row.product_tags),
    productDescription: row.product_description,
    headline: row.headline,
    body: row.body,
    cta: row.cta,
    variantLabel: row.variant_label as WinnerCreative["variantLabel"],
    embeddingProduct: decodeEmbedding(row.embedding_product),
    embeddingCopy: decodeEmbedding(row.embedding_copy),
    qualifiedAt: row.qualified_at,
    impressions: row.impressions,
    inlineLinkClickCtr: row.inline_link_click_ctr,
  };
}

export class WinnerStore {
  constructor(private db: CreativesDb) {}

  insert(w: WinnerCreative): void {
    this.db
      .prepare(
        `INSERT INTO winners (
          id, creative_id, product_category, product_tags, product_description,
          headline, body, cta, variant_label,
          embedding_product, embedding_copy,
          qualified_at, impressions, inline_link_click_ctr
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        w.id,
        w.creativeId,
        w.productCategory,
        JSON.stringify(w.productTags),
        w.productDescription,
        w.headline,
        w.body,
        w.cta,
        w.variantLabel,
        encodeEmbedding(w.embeddingProduct),
        encodeEmbedding(w.embeddingCopy),
        w.qualifiedAt,
        w.impressions,
        w.inlineLinkClickCtr,
      );
  }

  loadAll(): WinnerCreative[] {
    const rows = this.db.prepare("SELECT * FROM winners").all() as WinnerRow[];
    return rows.map(rowToWinner);
  }

  hasCreative(creativeId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM winners WHERE creative_id = ? LIMIT 1")
      .get(creativeId);
    return row !== undefined;
  }
}
