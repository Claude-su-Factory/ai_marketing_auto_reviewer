import React from "react";
import { Box, Text, useInput } from "ink";
import type { DoneResult } from "./AppTypes.js";

interface Props {
  result: DoneResult;
  onBack: () => void;
}

export function DoneScreen({ result, onBack }: Props) {
  useInput(() => {
    onBack();
  });

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={50}>
      <Text bold>AD-AI</Text>
      <Text dimColor>{"─".repeat(46)}</Text>

      <Box marginTop={1}>
        {result.success ? (
          <Text color="green">✓ {result.message}</Text>
        ) : (
          <Text color="red">✗ {result.message}</Text>
        )}
      </Box>

      {result.logs.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {result.logs.map((log, i) => (
            <Text key={i} dimColor>· {log}</Text>
          ))}
        </Box>
      )}

      <Text dimColor marginTop={1}>{"─".repeat(46)}</Text>
      <Text dimColor>아무 키나 누르면 메뉴로 복귀</Text>
    </Box>
  );
}
