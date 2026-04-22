import React from "react";
import { Box, Text } from "ink";
import type { ActionKey, MenuItem } from "../AppTypes.js";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";

interface Props {
  onSelect: (key: ActionKey, input?: string) => void;
  mode: "browse" | "input";
  selectedIndex: number;
  inputValue: string;
  inputPrompt: string;
  items: MenuItem[];
}

type Category = "CREATION" | "REVIEW & LAUNCH" | "ANALYTICS";
const CATEGORY_OF: Record<ActionKey, Category> = {
  scrape: "CREATION", "add-product": "CREATION", generate: "CREATION",
  review: "REVIEW & LAUNCH", launch: "REVIEW & LAUNCH", pipeline: "REVIEW & LAUNCH",
  monitor: "ANALYTICS", improve: "ANALYTICS",
};
const CATEGORY_COLOR: Record<Category, string> = {
  CREATION: colors.accent, "REVIEW & LAUNCH": colors.review, ANALYTICS: colors.analytics,
};

export function MenuScreen({ items, selectedIndex, inputValue, inputPrompt, mode }: Props) {
  const categories: Category[] = ["CREATION", "REVIEW & LAUNCH", "ANALYTICS"];
  let flatIdx = 0;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Menu" }),
    React.createElement(Box, { flexDirection: "column", paddingX: 2, paddingY: 1 },
      ...categories.flatMap((cat) => [
        React.createElement(Text, { key: `h-${cat}`, color: colors.dim, bold: true }, cat),
        ...items.filter((it) => CATEGORY_OF[it.key] === cat).map((it) => {
          const selected = flatIdx === selectedIndex;
          const isSelected = selected;
          const row = React.createElement(Box, { key: it.key, gap: 1 },
            React.createElement(Text, { color: colors.accent }, isSelected ? icons.select : " "),
            React.createElement(Text, {
              color: CATEGORY_COLOR[cat],
              backgroundColor: isSelected ? colors.accent : undefined,
            }, it.label.padEnd(12)),
            React.createElement(Text, { color: colors.dim }, `${icons.bullet} ${it.description}`),
          );
          flatIdx++;
          return row;
        }),
        React.createElement(Text, { key: `s-${cat}` }, " "),
      ]),
    ),
    mode === "input"
      ? React.createElement(Box, { paddingX: 2 },
          React.createElement(Text, { color: colors.warning }, `${inputPrompt} `),
          React.createElement(Text, null, inputValue),
          React.createElement(Text, { color: colors.dim }, "▌"))
      : null,
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim },
        "↑↓ 이동   Enter 선택   Esc 뒤로   Q 종료")),
  );
}
