import React from "react";
import { Box, Text } from "ink";
import type { TaskProgress } from "./AppTypes.js";

export type PipelineStep = "scrape" | "generate" | "review" | "launch";
export type StepStatus = "pending" | "running" | "done" | "error";

interface Props {
  currentStep: PipelineStep;
  stepStatuses: Record<PipelineStep, StepStatus>;
  currentCourse: string;
  courseIndex: number;
  totalCourses: number;
  progressMessage: string;
  taskProgress?: TaskProgress;
}

const STEPS: PipelineStep[] = ["scrape", "generate", "review", "launch"];
const STEP_LABELS: Record<PipelineStep, string> = {
  scrape: "Scrape",
  generate: "Generate",
  review: "Review",
  launch: "Launch",
};

function stepIcon(status: StepStatus): string {
  switch (status) {
    case "done": return "✓";
    case "running": return "⟳";
    case "error": return "✗";
    default: return "○";
  }
}

function stepColor(status: StepStatus): string {
  switch (status) {
    case "done": return "green";
    case "running": return "yellow";
    case "error": return "red";
    default: return "gray";
  }
}

function renderBar(pct: number, width = 12): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function taskIcon(pct: number): string {
  if (pct >= 100) return "✓";
  if (pct > 0) return "⟳";
  return "○";
}

function taskColor(pct: number): string {
  if (pct >= 100) return "green";
  if (pct > 0) return "yellow";
  return "gray";
}

export function PipelineProgress({
  stepStatuses,
  currentCourse,
  courseIndex,
  totalCourses,
  progressMessage,
  taskProgress,
}: Props) {
  const overall = taskProgress
    ? Math.round((taskProgress.copy + taskProgress.image + taskProgress.video) / 3)
    : undefined;

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={60}>
      <Box justifyContent="space-between">
        <Text bold>AD-AI Pipeline</Text>
        <Text dimColor>v1.0.0</Text>
      </Box>
      <Box marginTop={1}>
        {STEPS.map((step, i) => (
          <Box key={step} marginRight={2}>
            <Text color={stepColor(stepStatuses[step])}>
              [{i + 1}] {STEP_LABELS[step]} {stepIcon(stepStatuses[step])}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>강의: {currentCourse} ({courseIndex}/{totalCourses})</Text>
      </Box>

      {taskProgress ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={taskColor(taskProgress.copy)}>
            카피    {renderBar(taskProgress.copy)} {String(taskProgress.copy).padStart(3)}% {taskIcon(taskProgress.copy)}
          </Text>
          <Text color={taskColor(taskProgress.image)}>
            이미지  {renderBar(taskProgress.image)} {String(taskProgress.image).padStart(3)}% {taskIcon(taskProgress.image)}
          </Text>
          <Text color={taskColor(taskProgress.video)}>
            영상    {renderBar(taskProgress.video)} {String(taskProgress.video).padStart(3)}% {taskIcon(taskProgress.video)}
          </Text>
          <Box marginTop={1}>
            <Text color="yellow">
              전체    {renderBar(overall!)} {String(overall).padStart(3)}%
            </Text>
          </Box>
        </Box>
      ) : (
        progressMessage && (
          <Box marginTop={1}>
            <Text color="cyan">▶ {progressMessage}</Text>
          </Box>
        )
      )}
    </Box>
  );
}
