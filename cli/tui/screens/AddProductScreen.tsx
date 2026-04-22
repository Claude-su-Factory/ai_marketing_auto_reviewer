import React from "react";
import { Box, Text } from "ink";
import type { Product } from "../../../core/types.js";
import { colors, icons } from "../theme/tokens.js";
import { Header } from "../components/Header.js";
import { StatusBar } from "../components/StatusBar.js";

export type FormStep = "name" | "description" | "targetUrl" | "price";

interface Props {
  currentStep: FormStep;
  formData: Partial<Product>;
  inputValue: string;
  onSubmit: () => void;
  onCancel: () => void;
}

const FIELDS: { key: FormStep; label: string; render: (p: Partial<Product>) => string }[] = [
  { key: "name",        label: "제품명",     render: (p) => p.name ?? "" },
  { key: "description", label: "설명",       render: (p) => p.description ?? "" },
  { key: "targetUrl",   label: "랜딩 URL",   render: (p) => p.targetUrl ?? "" },
  { key: "price",       label: "가격(원)",   render: (p) => p.price != null ? String(p.price) : "" },
];

export function AddProductScreen({ currentStep, formData, inputValue }: Props) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Header, { rightSlot: "Add Product" }),
    React.createElement(Box, { paddingX: 2, paddingY: 1, flexDirection: "column" },
      React.createElement(Text, { color: colors.accent, bold: true }, `${icons.header} Add Product — 수동 입력`),
      React.createElement(Text, null, " "),
      ...FIELDS.map((f) => {
        const current = f.key === currentStep;
        const value = current ? inputValue : f.render(formData);
        const filled = value !== "";
        const iconStr = current ? icons.running : filled ? icons.success : icons.pending;
        const col = current ? colors.warning : filled ? colors.success : colors.dim;
        return React.createElement(Box, { key: f.key, gap: 1 },
          React.createElement(Text, { color: col }, iconStr),
          React.createElement(Text, null, f.label.padEnd(10)),
          React.createElement(Text, { color: current ? colors.fg : colors.dim }, value || "—"),
          current ? React.createElement(Text, { color: colors.dim }, "▌") : null,
        );
      }),
    ),
    React.createElement(StatusBar, { winners: null }),
    React.createElement(Box, { paddingX: 2 },
      React.createElement(Text, { color: colors.dim }, "Enter 다음   Esc 취소")),
  );
}
