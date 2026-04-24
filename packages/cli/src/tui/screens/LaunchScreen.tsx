import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

interface Props { progress: RunProgress; }

const STEPS = [
  { key: "campaign", label: "campaign", match: /\/campaigns/ },
  { key: "adset",    label: "adset",    match: /\/adsets/ },
  { key: "creative", label: "creative", match: /adcreative/i },
  { key: "ad",       label: "ad",       match: /\/ads(\?|$)/ },
];

export function LaunchScreen({ progress }: Props) {
  const logs = progress.launchLogs ?? [];
  const active = logs.length > 0 ? logs.at(-1)!.path : "";
  const reached = STEPS.map((s) => logs.some((l) => s.match.test(l.path)));
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Launch" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.review, bold: true }, `${icons.header} Launch — Meta 게재`),
      React.createElement(Text, null, " "),
      ...STEPS.map((s, idx) => {
        const isDone = reached[idx];
        const isActive = !isDone && STEPS.findIndex((x) => x.match.test(active)) === idx;
        const icon = isDone ? icons.success : isActive ? icons.running : icons.pending;
        const col = isDone ? colors.success : isActive ? colors.warning : colors.dim;
        return React.createElement(Text, { key: s.key, color: col }, `${icon}  ${s.label}`);
      }),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, "── 최근 로그 ────"),
      ...logs.slice(-3).map((l, i) => React.createElement(Text, { key: `${l.ts}-${i}`, color: colors.dim },
        `${l.ts}  ${l.method} ${l.path} → ${l.status}${l.refId ? ` ${l.refId}` : ""}`)),
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
