import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme/tokens.js";
import { listJson } from "@ad-ai/core/storage.js";
import { useTodayStats } from "../hooks/useTodayStats.js";

interface Props { winners: number | null; }

export function StatusBar({ winners }: Props) {
  const [products, setProducts] = useState(0);
  const [creatives, setCreatives] = useState(0);
  const { todayCount } = useTodayStats();

  useEffect(() => {
    void listJson("data/products").then((p) => setProducts(p.length));
    void listJson("data/creatives").then((p) => setCreatives(p.length));
  }, []);

  const winnersLabel = winners === null ? "—" : String(winners);
  return React.createElement(Box, { borderStyle: "round", borderColor: colors.dim, paddingX: 1, gap: 3 },
    React.createElement(Text, { color: colors.dim }, `products: ${products}`),
    React.createElement(Text, { color: colors.dim }, `creatives: ${creatives}`),
    React.createElement(Text, { color: colors.success }, `today ✓ ${todayCount}`),
    React.createElement(Text, { color: colors.analytics }, `winners: ${winnersLabel}`),
  );
}
