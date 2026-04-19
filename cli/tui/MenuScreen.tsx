import React from "react";
import { Box, Text } from "ink";
import { MENU_ITEMS } from "./AppTypes.js";
import type { ActionKey, MenuItem } from "./AppTypes.js";

interface Props {
  onSelect: (key: ActionKey, inputValue?: string) => void;
  mode: "browse" | "input";
  selectedIndex: number;
  inputValue: string;
  inputPrompt: string;
  items?: MenuItem[];
}

export function MenuScreen({ mode, selectedIndex, inputValue, inputPrompt, items }: Props) {
  const menuItems = items ?? MENU_ITEMS;
  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={50}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">AD-AI</Text>
        <Text dimColor>v1.0.0</Text>
      </Box>
      <Text dimColor>{"─".repeat(46)}</Text>

      <Box marginTop={1} flexDirection="column">
        {menuItems.map((item, i) => (
          <Box key={item.key}>
            <Text color={i === selectedIndex ? "cyan" : "white"}>
              {i === selectedIndex ? "▶ " : "  "}
              {item.label.padEnd(10)}
            </Text>
            <Text dimColor>{item.description}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{"─".repeat(46)}</Text>
      </Box>

      {mode === "input" ? (
        <Box flexDirection="column">
          <Text color="yellow">{inputPrompt}</Text>
          <Text color="cyan">{inputValue}_</Text>
          <Text dimColor>[Esc] 취소</Text>
        </Box>
      ) : (
        <Text dimColor>↑↓ 이동  Enter 선택  Q 종료</Text>
      )}
    </Box>
  );
}
