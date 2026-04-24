import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

const STAGES = [
  { key: "load",     label: "리포트 로드",          match: /리포트|reports/i },
  { key: "stats",    label: "통계 계산",             match: /통계|stats/i },
  { key: "claude",   label: "Claude 분석",           match: /Claude|분석/i },
  { key: "save",     label: "improvements 저장",     match: /improvements/i },
  { key: "winners",  label: "winners 업데이트",      match: /winners/i },
];

interface Props { progress: RunProgress; }

export function ImproveScreen({ progress }: Props) {
  const msg = progress.message;
  const activeIdx = STAGES.findIndex((s) => s.match.test(msg));
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Improve" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.analytics, bold: true }, `${icons.header} Improve — 자율 개선`),
      React.createElement(Text, null, " "),
      ...STAGES.map((s, idx) => {
        const status = idx < activeIdx ? "done" : idx === activeIdx ? "running" : "pending";
        const icon = status === "done" ? icons.success : status === "running" ? icons.running : icons.pending;
        const col = status === "done" ? colors.success : status === "running" ? colors.warning : colors.dim;
        return React.createElement(Text, { key: s.key, color: col }, `${icon}  ${s.label}`);
      }),
      React.createElement(Text, null, " "),
      React.createElement(Text, { color: colors.dim }, msg),
    ),
    React.createElement(StatusBar, { winners: null }),
  );
}
