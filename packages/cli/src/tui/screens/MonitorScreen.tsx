import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import { useReports } from "../hooks/useReports.js";
import { aggregateVariantReports, sortByCtr } from "../monitor/metrics.js";
import { formatPct } from "../format.js";

type Win = 7 | 14 | 30;

interface Props { onBack?: () => void; }

export function MonitorScreen({ onBack }: Props) {
  const [win, setWin] = useState<Win>(7);
  const { reports, loading } = useReports(win);
  const agg = aggregateVariantReports(reports);
  const sorted = sortByCtr(reports);
  const top = sorted.slice(0, 3);
  const bottom = sorted.slice(-3).reverse();

  useInput((input, key) => {
    if (key.escape) onBack?.();
    if (input === "t" || input === "T") setWin((w) => (w === 7 ? 14 : w === 14 ? 30 : 7));
  });

  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Monitor" }),
    React.createElement(Box, { paddingX: 2, gap: 2 },
      React.createElement(Text, null, `Window: ${win === 7 ? "[7d]" : " 7d "} ${win === 14 ? "[14d]" : " 14d "} ${win === 30 ? "[30d]" : " 30d "}`),
    ),
    React.createElement(Box, { paddingX: 2, flexDirection: "column" },
      React.createElement(Text, { color: colors.dim }, "── OVERVIEW ────"),
      React.createElement(Text, null,
        `variants  ${agg.variants}     avg CTR  ${formatPct(agg.avgCtr)}     impressions  ${agg.impressions.toLocaleString()}`),
      React.createElement(Text, null,
        `winners   —     clicks   ${agg.clicks.toLocaleString()}`),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, "── TOP 3 (by CTR) ────"),
      ...top.map((r) => React.createElement(Text, { key: r.id, color: colors.success },
        `${icons.up}  ${r.productId.slice(0,16)} · ${r.variantLabel}   CTR ${formatPct(r.inlineLinkClickCtr)}  impr ${r.impressions.toLocaleString()}  clicks ${r.clicks.toLocaleString()}`)),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, "── BOTTOM 3 ────"),
      ...bottom.map((r) => React.createElement(Text, { key: r.id, color: colors.danger },
        `${icons.down}  ${r.productId.slice(0,16)} · ${r.variantLabel}   CTR ${formatPct(r.inlineLinkClickCtr)}  impr ${r.impressions.toLocaleString()}  clicks ${r.clicks.toLocaleString()}`)),
      loading ? React.createElement(Text, { color: colors.warning }, "loading...") : null,
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "R 새로고침  T 윈도우(7/14/30)  Esc 뒤로")),
  );
}
