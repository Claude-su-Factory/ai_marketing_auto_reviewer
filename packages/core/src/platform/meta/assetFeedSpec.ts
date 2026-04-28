import type { Creative, Product } from "../../types.js";

export interface AssetFeedSpecInput {
  product: Product;
  creatives: Creative[];
  imageHash: string;
}

export interface AssetFeedSpec {
  titles: { text: string }[];
  bodies: { text: string; adlabels: { name: string }[] }[];
  link_urls: { website_url: string }[];
  images: { hash: string }[];
  call_to_action_types: string[];
}

export function assembleAssetFeedSpec(input: AssetFeedSpecInput): AssetFeedSpec {
  const { product, creatives, imageHash } = input;
  if (creatives.length === 0) {
    throw new Error("assembleAssetFeedSpec requires at least one creative");
  }

  const sharedHeadline = creatives[0].copy.headline;
  const sharedCta = creatives[0].copy.cta;

  const normalize = (t: string) => t.replace(/\r\n/g, "\n").trim();
  const bodies = creatives.map((c) => {
    const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
    const text = hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
    return {
      text,
      adlabels: [{ name: c.copy.assetLabel }],
    };
  });

  // Validate: after CRLF/trim normalization, every body.text must be unique.
  // Otherwise parseBodyAssetBreakdown will silently attribute performance to
  // the first matching creative (Strategy B collision).
  const seen = new Map<string, string>();
  for (let i = 0; i < bodies.length; i++) {
    const key = normalize(bodies[i].text);
    if (seen.has(key)) {
      throw new Error(
        `assembleAssetFeedSpec: duplicate body text in variant group. ` +
          `Creative[${seen.get(key)}] and Creative[${i}] produce the same normalized text. ` +
          `Regenerate one of the copies.`,
      );
    }
    seen.set(key, String(i));
  }

  return {
    titles: [{ text: sharedHeadline }],
    bodies,
    link_urls: [{ website_url: product.targetUrl }],
    images: [{ hash: imageHash }],
    call_to_action_types: [sharedCta],
  };
}
