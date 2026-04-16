import React, { useState, useEffect, useCallback } from "react";
import { useInput } from "ink";
import type { AppState, ActionKey, RunProgress, DoneResult } from "./AppTypes.js";
import { MENU_ITEMS } from "./AppTypes.js";
import { MenuScreen } from "./MenuScreen.js";
import { DoneScreen } from "./DoneScreen.js";
import { PipelineProgress } from "./PipelineProgress.js";
import type { PipelineStep, StepStatus } from "./PipelineProgress.js";
import { ReviewScreen } from "./ReviewScreen.js";
import {
  runScrape, runGenerate, runLaunch, runMonitor,
  runImprove, runPipelineAction, validateMonitorMode,
} from "./actions.js";
import { readJson, writeJson, listJson } from "../storage.js";
import { applyReviewDecision } from "../reviewer/index.js";
import type { Creative, Course } from "../types.js";

export function getNextStateForAction(key: ActionKey): AppState {
  if (key === "review") return "review";
  const item = MENU_ITEMS.find((m) => m.key === key);
  return item?.needsInput ? "input" : "running";
}

const DEFAULT_STEP_STATUSES: Record<PipelineStep, StepStatus> = {
  scrape: "pending",
  generate: "pending",
  review: "pending",
  launch: "pending",
};

export function App() {
  const [appState, setAppState] = useState<AppState>("menu");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [currentAction, setCurrentAction] = useState<ActionKey | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress>({ message: "" });
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [reviewItems, setReviewItems] = useState<Array<{ creative: Creative; course: Course }>>([]);

  const handleProgressUpdate = useCallback((p: RunProgress) => {
    setRunProgress(p);
  }, []);

  const executeAction = useCallback(async (key: ActionKey, inputVal?: string) => {
    setAppState("running");
    setRunProgress({ message: "시작 중..." });

    let result: DoneResult;

    switch (key) {
      case "scrape":
        result = await runScrape(inputVal ?? "", handleProgressUpdate);
        break;
      case "generate":
        result = await runGenerate(handleProgressUpdate);
        break;
      case "launch":
        result = await runLaunch(handleProgressUpdate);
        break;
      case "monitor": {
        const mode = validateMonitorMode(inputVal ?? "");
        if (!mode) {
          result = { success: false, message: "Monitor 실패", logs: ["d 또는 w를 입력하세요"] };
        } else {
          result = await runMonitor(mode, handleProgressUpdate);
        }
        break;
      }
      case "improve":
        result = await runImprove(handleProgressUpdate);
        break;
      case "pipeline":
        result = await runPipelineAction(
          (inputVal ?? "").split(/\s+/).filter(Boolean),
          handleProgressUpdate
        );
        break;
      default:
        result = { success: false, message: "알 수 없는 액션", logs: [] };
    }

    setDoneResult(result);
    setAppState("done");
  }, [handleProgressUpdate]);

  const loadReviewItems = useCallback(async () => {
    const creativePaths = await listJson("data/creatives");
    const items: Array<{ creative: Creative; course: Course }> = [];
    for (const p of creativePaths) {
      const creative = await readJson<Creative>(p);
      if (!creative || creative.status !== "pending") continue;
      const course = await readJson<Course>(`data/courses/${creative.courseId}.json`);
      if (course) items.push({ creative, course });
    }
    setReviewItems(items);
  }, []);

  useEffect(() => {
    if (appState === "review") {
      loadReviewItems();
    }
  }, [appState, loadReviewItems]);

  useInput((input, key) => {
    // running/review 상태에서는 해당 컴포넌트가 직접 입력을 처리
    if (appState === "running" || appState === "review") return;

    if (appState === "menu") {
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectedIndex((i) => Math.min(MENU_ITEMS.length - 1, i + 1));
      if (input === "q" || input === "Q") process.exit(0);
      if (key.return) {
        const item = MENU_ITEMS[selectedIndex];
        setCurrentAction(item.key);
        const nextState = getNextStateForAction(item.key);
        setInputValue("");
        setAppState(nextState);
        if (nextState === "running") executeAction(item.key);
      }
      return;
    }

    if (appState === "input") {
      if (key.escape) {
        setAppState("menu");
        setInputValue("");
        return;
      }
      if (key.return) {
        const action = currentAction!;
        const val = inputValue;
        setInputValue("");
        executeAction(action, val);
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setInputValue((v) => v + input);
      }
    }
  });

  const currentMenuItem = MENU_ITEMS[selectedIndex];

  if (appState === "menu" || appState === "input") {
    return React.createElement(MenuScreen, {
      onSelect: executeAction,
      mode: appState === "input" ? "input" : "browse",
      selectedIndex,
      inputValue,
      inputPrompt: currentMenuItem?.inputPrompt ?? "",
    });
  }

  if (appState === "running") {
    return React.createElement(PipelineProgress, {
      currentStep: "generate",
      stepStatuses: DEFAULT_STEP_STATUSES,
      currentCourse: runProgress.currentCourse ?? "",
      courseIndex: runProgress.courseIndex ?? 0,
      totalCourses: runProgress.totalCourses ?? 0,
      progressMessage: runProgress.message,
      taskProgress: runProgress.taskProgress,
    });
  }

  if (appState === "done" && doneResult) {
    return React.createElement(DoneScreen, {
      result: doneResult,
      onBack: () => {
        setAppState("menu");
        setDoneResult(null);
        setRunProgress({ message: "" });
      },
    });
  }

  if (appState === "review") {
    return React.createElement(ReviewScreen, {
      creatives: reviewItems,
      onApprove: async (id) => {
        const item = reviewItems.find((i) => i.creative.id === id);
        if (!item) return;
        const updated = applyReviewDecision(item.creative, { action: "approve" });
        item.creative = updated;
        await writeJson(`data/creatives/${id}.json`, updated);
        if (reviewItems.every((i) => i.creative.status !== "pending")) {
          setDoneResult({
            success: true,
            message: "Review 완료",
            logs: [`${reviewItems.length}개 검토 완료`],
          });
          setAppState("done");
        }
      },
      onReject: async (id, note) => {
        const item = reviewItems.find((i) => i.creative.id === id);
        if (!item) return;
        const updated = applyReviewDecision(item.creative, { action: "reject", note });
        item.creative = updated;
        await writeJson(`data/creatives/${id}.json`, updated);
      },
      onEdit: async (id, field, value) => {
        const item = reviewItems.find((i) => i.creative.id === id);
        if (!item) return;
        const updated = applyReviewDecision(item.creative, { action: "edit", field, value });
        item.creative = updated;
        await writeJson(`data/creatives/${id}.json`, updated);
      },
    });
  }

  return null;
}
