import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Creative, Product } from "../../core/types.js";

export interface ReviewGroup {
  variantGroupId: string;
  product: Product;
  creatives: Creative[];
}

interface Props {
  groups: ReviewGroup[];
  onApprove: (variantGroupId: string, creativeId: string) => void;
  onReject: (variantGroupId: string, creativeId: string, note: string) => void;
  onEdit: (
    variantGroupId: string,
    creativeId: string,
    field: keyof Creative["copy"],
    value: string,
  ) => void;
}

export function ReviewScreen({ groups, onApprove, onReject, onEdit }: Props) {
  const [groupIndex, setGroupIndex] = useState(0);
  const [variantIndex, setVariantIndex] = useState(0);
  const [mode, setMode] = useState<"browse" | "edit" | "reject">("browse");
  const [inputValue, setInputValue] = useState("");

  const currentGroup = groups[groupIndex];
  const currentVariant = currentGroup?.creatives[variantIndex];

  useInput((input, key) => {
    if (mode === "browse") {
      if (key.upArrow) {
        setGroupIndex((i) => Math.max(0, i - 1));
        setVariantIndex(0);
      }
      if (key.downArrow) {
        setGroupIndex((i) => Math.min(groups.length - 1, i + 1));
        setVariantIndex(0);
      }
      if (input >= "1" && input <= "9" && currentGroup) {
        const n = Number(input) - 1;
        if (n < currentGroup.creatives.length) setVariantIndex(n);
      }
      if (input === "a" && currentGroup && currentVariant && currentVariant.status === "pending") {
        onApprove(currentGroup.variantGroupId, currentVariant.id);
      }
      if (input === "r" && currentGroup && currentVariant && currentVariant.status === "pending") {
        setMode("reject");
        setInputValue("");
      }
      if (input === "e" && currentGroup && currentVariant && currentVariant.status === "pending") {
        setMode("edit");
        setInputValue("");
      }
      return;
    }

    if (key.escape) {
      setMode("browse");
      setInputValue("");
      return;
    }
    if (key.return) {
      if (mode === "reject" && currentGroup && currentVariant) {
        onReject(currentGroup.variantGroupId, currentVariant.id, inputValue);
      }
      if (mode === "edit" && currentGroup && currentVariant) {
        onEdit(currentGroup.variantGroupId, currentVariant.id, "headline", inputValue);
      }
      setMode("browse");
      setInputValue("");
      return;
    }
    if (key.backspace || key.delete) {
      setInputValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputValue((v) => v + input);
    }
  });

  if (!currentGroup || !currentVariant) {
    return (
      <Box>
        <Text color="green">모든 검토 완료!</Text>
      </Box>
    );
  }

  const statusColor = (s: Creative["status"]) =>
    s === "approved" || s === "edited" ? "green" : s === "rejected" ? "red" : "yellow";

  return (
    <Box borderStyle="round" padding={1} width={90}>
      <Box flexDirection="column" width={24} marginRight={2}>
        <Text bold>그룹: {groupIndex + 1}/{groups.length}</Text>
        {groups.map((g, i) => {
          const approved = g.creatives.filter((c) => c.status === "approved" || c.status === "edited").length;
          return (
            <Text key={g.variantGroupId} color={i === groupIndex ? "cyan" : "white"}>
              {i === groupIndex ? "▶ " : "  "}
              {g.product.name.slice(0, 14)} ({approved}/{g.creatives.length})
            </Text>
          );
        })}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>Variants (1/2/3 선택)</Text>
        {currentGroup.creatives.map((c, i) => (
          <Text key={c.id} color={i === variantIndex ? "cyan" : "white"}>
            {i === variantIndex ? "▶ " : "  "}[{i + 1}] {c.copy.variantLabel}{" "}
            <Text color={statusColor(c.status)}>({c.status})</Text>
          </Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>이미지(공유): {currentVariant.imageLocalPath}</Text>
          <Text dimColor>영상(공유): {currentVariant.videoLocalPath}</Text>
          <Text>헤드라인: {currentVariant.copy.headline}</Text>
          <Text>본문: {currentVariant.copy.body}</Text>
          <Text>CTA: {currentVariant.copy.cta}</Text>
          <Text>태그: {currentVariant.copy.hashtags.join(" ")}</Text>
        </Box>
        {mode === "browse" && currentVariant.status === "pending" && (
          <Box marginTop={1}>
            <Text color="green">[A] 승인  </Text>
            <Text color="red">[R] 거절  </Text>
            <Text color="yellow">[E] 수정  </Text>
            <Text dimColor>↑↓ 그룹 이동 / 1-3 variant 선택</Text>
          </Box>
        )}
        {mode === "browse" && currentVariant.status !== "pending" && (
          <Box marginTop={1}>
            <Text dimColor>이 variant는 이미 처리됨. 다른 variant(1-3) 또는 그룹(↑↓) 선택.</Text>
          </Box>
        )}
        {mode === "reject" && (
          <Box marginTop={1} flexDirection="column">
            <Text>거절 이유 입력 후 Enter (Esc: 취소):</Text>
            <Text color="cyan">{inputValue}_</Text>
          </Box>
        )}
        {mode === "edit" && (
          <Box marginTop={1} flexDirection="column">
            <Text>새 헤드라인 입력 후 Enter (Esc: 취소):</Text>
            <Text color="yellow">{inputValue}_</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
