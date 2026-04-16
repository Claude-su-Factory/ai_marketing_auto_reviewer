import React from "react";
import { Box, Text } from "ink";

export type PipelineStep = "scrape" | "generate" | "review" | "launch";
export type StepStatus = "pending" | "running" | "done" | "error";

interface Props {
  currentStep: PipelineStep;
  stepStatuses: Record<PipelineStep, StepStatus>;
  currentCourse: string;
  courseIndex: number;
  totalCourses: number;
  progressMessage: string;
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

export function PipelineProgress({
  stepStatuses,
  currentCourse,
  courseIndex,
  totalCourses,
  progressMessage,
}: Props) {
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
      {progressMessage && (
        <Box marginTop={1}>
          <Text color="cyan">▶ {progressMessage}</Text>
        </Box>
      )}
    </Box>
  );
}
