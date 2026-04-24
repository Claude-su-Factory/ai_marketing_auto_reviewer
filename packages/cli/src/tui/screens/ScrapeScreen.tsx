import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { RunProgress } from "../AppTypes.js";

interface Props {
  stage: "input" | "running";
  inputValue: string;
  progress?: RunProgress;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}

const STAGES = [
  { key: "playwright", label: "Playwright 실행", match: /Playwright|브라우저/i },
  { key: "pageload",   label: "페이지 로드",     match: /networkidle|페이지/i },
  { key: "parse",      label: "Gemini 파싱",     match: /Gemini|파싱/i },
  { key: "save",       label: "제품 저장",       match: /저장됨|Scrape 완료/i },
];

export function ScrapeScreen({ stage, inputValue, progress }: Props) {
  if (stage === "input") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Header, { rightSlot: "Scrape" }),
      React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
        React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Scrape — URL 입력`),
        React.createElement(Text, { color: colors.dim }, "URL 자동 감지 (Gemini 파싱) — 어떤 제품 페이지든 시도"),
        React.createElement(Text, null, " "),
        React.createElement(Text, null, `URL: ${inputValue}▌`),
      ),
      React.createElement(StatusBar, { winners: null }),
      React.createElement(Box, { paddingX: 2 },
        React.createElement(Text, { color: colors.dim }, "Enter 시작   Esc 뒤로")),
    );
  }
  const msg = progress?.message ?? "";
  const activeIdx = STAGES.findIndex((s) => s.match.test(msg));
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Scrape" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Scrape — 진행 중`),
      React.createElement(Text, { color: colors.dim }, inputValue),
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
