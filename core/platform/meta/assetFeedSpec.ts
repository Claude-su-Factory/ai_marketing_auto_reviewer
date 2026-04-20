import type { Creative, Product } from "../../types.js";

export interface AssetFeedSpecInput {
  product: Product;
  creatives: Creative[];
  imageHash: string;
  videoId: string;
}

export interface AssetFeedSpec {
  titles: { text: string }[];
  bodies: { text: string; adlabels: { name: string }[] }[];
  link_urls: { website_url: string }[];
  images: { hash: string }[];
  videos: { video_id: string }[];
  call_to_action_types: string[];
}

export function assembleAssetFeedSpec(input: AssetFeedSpecInput): AssetFeedSpec {
  const { product, creatives, imageHash, videoId } = input;
  if (creatives.length === 0) {
    throw new Error("assembleAssetFeedSpec requires at least one creative");
  }

  const sharedHeadline = creatives[0].copy.headline;
  const sharedCta = creatives[0].copy.cta;

  const bodies = creatives.map((c) => {
    const hashtags = c.copy.hashtags.map((t) => `#${t}`).join(" ");
    const text = hashtags ? `${c.copy.body}\n\n${hashtags}` : c.copy.body;
    return {
      text,
      adlabels: [{ name: c.copy.metaAssetLabel }],
    };
  });

  return {
    titles: [{ text: sharedHeadline }],
    bodies,
    link_urls: [{ website_url: product.targetUrl }],
    images: [{ hash: imageHash }],
    videos: [{ video_id: videoId }],
    call_to_action_types: [sharedCta],
  };
}
