import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Creative, Course } from "../types.js";

interface Props {
  creatives: Array<{ creative: Creative; course: Course }>;
  onApprove: (creativeId: string) => void;
  onReject: (creativeId: string, note: string) => void;
  onEdit: (creativeId: string, field: keyof Creative["copy"], value: string) => void;
}

export function ReviewScreen({ creatives, onApprove, onReject, onEdit }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"browse" | "edit" | "reject">("browse");
  const [inputValue, setInputValue] = useState("");

  const pending = creatives.filter((c) => c.creative.status === "pending");
  const current = pending[selectedIndex];

  useInput((input, key) => {
    if (mode !== "browse") return;
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex((i) => Math.min(pending.length - 1, i + 1));
    if (input === "a" && current) onApprove(current.creative.id);
    if (input === "r" && current) setMode("reject");
    if (input === "e" && current) setMode("edit");
  });

  if (!current) {
    return (
      <Box>
        <Text color="green">모든 검토 완료!</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" padding={1} width={70}>
      <Box flexDirection="column" width={20} marginRight={2}>
        <Text bold>검토 대기: {pending.length}개</Text>
        {pending.map((item, i) => (
          <Text key={item.creative.id} color={i === selectedIndex ? "cyan" : "white"}>
            {i === selectedIndex ? "▶ " : "  "}
            {item.course.title.slice(0, 16)}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold>미리보기</Text>
        <Text dimColor>이미지: {current.creative.imageLocalPath}</Text>
        <Text dimColor>영상: {current.creative.videoLocalPath}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>헤드라인: {current.creative.copy.headline}</Text>
          <Text>본문: {current.creative.copy.body}</Text>
          <Text>CTA: {current.creative.copy.cta}</Text>
          <Text>태그: {current.creative.copy.hashtags.join(" ")}</Text>
        </Box>
        {mode === "browse" && (
          <Box marginTop={1}>
            <Text color="green">[A] 승인  </Text>
            <Text color="red">[R] 거절  </Text>
            <Text color="yellow">[E] 수정</Text>
          </Box>
        )}
        {mode === "reject" && (
          <Box marginTop={1} flexDirection="column">
            <Text>거절 이유 입력 후 Enter:</Text>
            <Text color="cyan">{inputValue}_</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
