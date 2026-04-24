import React from "react";
import { Box, Text } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { useWorkerStatus } from "../hooks/useWorkerStatus.js";

interface Props { rightSlot?: string; }

export function Header({ rightSlot }: Props) {
  const { active } = useWorkerStatus();
  return React.createElement(
    Box, { borderStyle: "round", borderColor: colors.review, paddingX: 1, justifyContent: "space-between" },
    React.createElement(Box, { gap: 2 },
      React.createElement(Text, { color: colors.accent, bold: true }, "AD-AI"),
      React.createElement(Text, { color: colors.dim }, "v1.0.0"),
      React.createElement(Text, { color: colors.success }, `${icons.bullet} owner`),
      React.createElement(Text, { color: active ? colors.success : colors.dim },
        `${active ? icons.bullet : icons.pending} worker${active ? "" : " inactive"}`),
    ),
    rightSlot ? React.createElement(Text, { color: colors.dim }, rightSlot) : null,
  );
}
