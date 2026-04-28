import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

interface PipelineScreenProps {
  progress: RunProgress;
  currentStage: "scrape" | "generate";
}

export function PipelineScreen({ progress, currentStage }: PipelineScreenProps) {
  const scrapeStatus = currentStage === "scrape" ? "running" : "done";
  const generateStatus = currentStage === "generate" ? "running" : "pending";

  const scrapeIcon = scrapeStatus === "done" ? icons.success : icons.running;
  const scrapeColor = scrapeStatus === "done" ? colors.success : colors.warning;

  const generateIcon = generateStatus === "running" ? icons.running : icons.pending;
  const generateColor = generateStatus === "running" ? colors.warning : colors.dim;

  const gp = progress.generate;
  let genSummary: string | null = null;
  if (gp) {
    const doneCount = gp.queue.filter((s) => s === "done").length;
    const total = gp.queue.length;
    const copyPct = gp.tracks.copy.pct;
    const imagePct = gp.tracks.image.pct;
    genSummary = `gen: copies ${Math.round(copyPct)}/${100} | images ${Math.round(imagePct)}/${100}  [${doneCount}/${total}]`;
  }

  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Pipeline" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Pipeline — 전체 파이프라인`),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: scrapeColor }, `${scrapeIcon}  [1] Scrape`),
      React.createElement(Text, { color: generateColor }, `${generateIcon}  [2] Generate`),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, progress.message),
      genSummary ? React.createElement(Text, { color: colors.dim }, genSummary) : null,
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
