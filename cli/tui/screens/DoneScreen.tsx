import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";
import type { DoneResult } from "../AppTypes.js";

interface Props { result: DoneResult; onBack: () => void; }

export function DoneScreen({ result, onBack }: Props) {
  const [expanded, setExpanded] = useState(false);
  useInput((input, key) => {
    if (key.return || key.escape) onBack();
    if (input === "v" || input === "V") setExpanded((x) => !x);
  });
  const shown = expanded ? result.logs : result.logs.slice(-3);
  const headerIcon = result.success ? icons.success : icons.failure;
  const headerCol = result.success ? colors.success : colors.danger;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Done" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column", borderStyle: "round", borderColor: headerCol },
      React.createElement(Text, { color: headerCol, bold: true }, `${headerIcon}  ${result.message}`),
      React.createElement(Text, null, " "),
      ...shown.map((l, i) => React.createElement(Text, { key: i, color: colors.dim }, l)),
      !expanded && result.logs.length > 3
        ? React.createElement(Text, { color: colors.dim }, `... (V 키로 전체 ${result.logs.length}줄 보기)`)
        : null,
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "Enter/Esc 메뉴로   V 전체 로그 토글")),
  );
}
