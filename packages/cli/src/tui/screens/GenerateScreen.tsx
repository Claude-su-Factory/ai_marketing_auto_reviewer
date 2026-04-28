import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import { ProgressTrack } from "../components/ProgressTrack.js";
import type { RunProgress } from "../AppTypes.js";

interface Props { progress: RunProgress; }

export function GenerateScreen({ progress }: Props) {
  const g = progress.generate;
  if (!g) return React.createElement(Text, null, "준비 중...");
  const doneCount = g.queue.filter((s) => s === "done").length;
  const totalCount = g.queue.length;
  const elapsedSec = Math.round(g.elapsedMs / 1000);
  const overallPct = Math.round((g.tracks.copy.pct + g.tracks.image.pct) / 2);
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Generate" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Generate — 소재 생성 중`),
      React.createElement(Text, null,
        `큐:  ${g.queue.map((s) => s === "done" ? "[✓]" : s === "running" ? "[⟳]" : "[ ]").join(" ")}  (${doneCount}/${totalCount})`),
      React.createElement(Text, null, `제품:  ${g.currentProduct.name}`),
      React.createElement(Text, { color: colors.dim }, " "),
      React.createElement(ProgressTrack, { label: "카피", status: g.tracks.copy.status, pct: g.tracks.copy.pct, detail: g.tracks.copy.label }),
      React.createElement(ProgressTrack, { label: "이미지", status: g.tracks.image.status, pct: g.tracks.image.pct, detail: g.tracks.image.label }),
      React.createElement(Text, { color: colors.dim }, "────────────────────────────"),
      React.createElement(Text, null, `전체     ${"█".repeat(Math.round(overallPct / 5))}${"░".repeat(20 - Math.round(overallPct / 5))}  ${overallPct}%  elapsed ${elapsedSec}s`),
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "Esc 취소 (현재 제품 완료 후 중단)")),
  );
}
