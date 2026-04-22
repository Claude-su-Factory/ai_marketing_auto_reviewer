import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";

export type TrackStatus = "pending" | "running" | "done";

interface Props { label: string; status: TrackStatus; pct: number; detail?: string; }

const BAR_WIDTH = 20;

export function ProgressTrack({ label, status, pct, detail }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  const icon = status === "done" ? icons.success : status === "running" ? icons.running : icons.pending;
  const iconColor = status === "done" ? colors.success : status === "running" ? colors.warning : colors.dim;
  return React.createElement(
    Box, { gap: 1 },
    React.createElement(Text, { color: iconColor }, icon),
    React.createElement(Text, null, label.padEnd(6)),
    React.createElement(Text, { color: colors.accent }, bar),
    React.createElement(Text, { color: colors.fg }, `${clamped}%`),
    detail && React.createElement(Text, { color: colors.dim }, detail),
  );
}
