import React, { useState, useEffect, useCallback } from "react";
import { useInput } from "ink";
import type { AppState, ActionKey, RunProgress, DoneResult } from "./AppTypes.js";
import { MENU_ITEMS } from "./AppTypes.js";
import { MenuScreen } from "./screens/MenuScreen.js";
import { DoneScreen } from "./screens/DoneScreen.js";
import { ScrapeScreen } from "./screens/ScrapeScreen.js";
import { AddProductScreen } from "./screens/AddProductScreen.js";
import { PipelineProgress } from "./PipelineProgress.js";
import type { PipelineStep, StepStatus } from "./PipelineProgress.js";
import { GenerateScreen } from "./screens/GenerateScreen.js";
import { LaunchScreen } from "./screens/LaunchScreen.js";
import { ImproveScreen } from "./screens/ImproveScreen.js";
import { MonitorScreen } from "./screens/MonitorScreen.js";
import { ReviewScreen, type ReviewGroup } from "./screens/ReviewScreen.js";
import {
  runScrape, runGenerate, runLaunch,
  runImprove, runPipelineAction,
} from "../actions.js";
import { readJson, writeJson, listJson } from "../../core/storage.js";
import { applyReviewDecision } from "../../core/reviewer/decisions.js";
import type { Creative, Product } from "../../core/types.js";
import { groupCreativesByVariantGroup } from "../../core/launch/groupApproval.js";
import { randomUUID } from "crypto";

type FormStep = "name" | "description" | "targetUrl" | "price";

const FORM_STEPS: FormStep[] = ["name", "description", "targetUrl", "price"];

const FORM_PROMPTS: Record<FormStep, string> = {
  name: "제품명 입력:",
  description: "제품 설명 입력:",
  targetUrl: "광고 랜딩 URL 입력:",
  price: "가격 입력 (없으면 Enter 스킵):",
};

export function getNextStateForAction(key: ActionKey): AppState {
  if (key === "review") return "review";
  if (key === "monitor") return "monitor";
  if (key === "add-product") return "input";
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
  const [reviewGroups, setReviewGroups] = useState<ReviewGroup[]>([]);
  const [formStep, setFormStep] = useState<FormStep>("name");
  const [formData, setFormData] = useState<Partial<Product>>({});
  const [scrapeUrl, setScrapeUrl] = useState("");

  const visibleMenuItems = MENU_ITEMS;

  const handleProgressUpdate = useCallback((p: RunProgress) => {
    setRunProgress(p);
  }, []);

  const executeAction = useCallback(async (key: ActionKey, inputVal?: string) => {
    setAppState("running");
    setRunProgress({ message: "시작 중..." });
    let result: DoneResult;
    switch (key) {
      case "scrape":      result = await runScrape(inputVal ?? "", handleProgressUpdate); break;
      case "generate":    result = await runGenerate(handleProgressUpdate); break;
      case "launch":      result = await runLaunch(handleProgressUpdate); break;
      case "improve":     result = await runImprove(handleProgressUpdate); break;
      case "pipeline":    result = await runPipelineAction((inputVal ?? "").split(/\s+/).filter(Boolean), handleProgressUpdate); break;
      default:            result = { success: false, message: "알 수 없는 액션", logs: [] };
    }
    setDoneResult(result);
    setAppState("done");
  }, [handleProgressUpdate]);

  const loadReviewGroups = useCallback(async () => {
    const creativePaths = await listJson("data/creatives");
    const allCreatives: Creative[] = [];
    for (const p of creativePaths) {
      const c = await readJson<Creative>(p);
      if (c) allCreatives.push(c);
    }
    const grouped = groupCreativesByVariantGroup(allCreatives);
    const pending: ReviewGroup[] = [];
    for (const [variantGroupId, members] of grouped.entries()) {
      if (!members.some((c) => c.status === "pending")) continue;
      const product = await readJson<Product>(`data/products/${members[0].productId}.json`);
      if (!product) continue;
      pending.push({ variantGroupId, product, creatives: members });
    }
    setReviewGroups(pending);
  }, []);

  useEffect(() => {
    if (appState === "review") {
      loadReviewGroups();
    }
  }, [appState, loadReviewGroups]);

  useInput((input, key) => {
    // running/review/monitor 상태에서는 해당 컴포넌트가 직접 입력을 처리
    if (appState === "running" || appState === "review" || appState === "monitor") return;

    if (appState === "menu") {
      if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectedIndex((i) => Math.min(visibleMenuItems.length - 1, i + 1));
      if (input === "q" || input === "Q") process.exit(0);
      if (key.return) {
        const item = visibleMenuItems[selectedIndex];
        setCurrentAction(item.key);
        if (item.key === "add-product") {
          setFormStep("name");
          setFormData({});
          setInputValue("");
          setAppState("input");
          return;
        }
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
        setFormStep("name");
        setFormData({});
        return;
      }
      if (key.return && currentAction === "add-product") {
        const currentIdx = FORM_STEPS.indexOf(formStep);
        const newFormData = { ...formData };

        if (formStep === "name") newFormData.name = inputValue;
        else if (formStep === "description") newFormData.description = inputValue;
        else if (formStep === "targetUrl") newFormData.targetUrl = inputValue;
        else if (formStep === "price") newFormData.price = inputValue ? Number(inputValue) : undefined;

        setFormData(newFormData);
        setInputValue("");

        if (currentIdx < FORM_STEPS.length - 1) {
          setFormStep(FORM_STEPS[currentIdx + 1]);
        } else {
          const product: Product = {
            id: randomUUID(),
            name: newFormData.name ?? "",
            description: newFormData.description ?? "",
            targetUrl: newFormData.targetUrl ?? "",
            price: newFormData.price,
            currency: "KRW",
            imageUrl: undefined,
            category: undefined,
            tags: [],
            inputMethod: "manual",
            createdAt: new Date().toISOString(),
          };
          void writeJson(`data/products/${product.id}.json`, product).then(() => {
            setDoneResult({
              success: true,
              message: "제품 추가 완료",
              logs: [`${product.name} 저장됨 (ID: ${product.id})`],
            });
            setFormData({});
            setFormStep("name");
            setAppState("done");
          });
        }
        return;
      }
      if (key.return) {
        const action = currentAction!;
        const val = inputValue;
        if (action === "scrape") setScrapeUrl(val);
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

  const currentMenuItem = visibleMenuItems[selectedIndex];

  if (appState === "input" && currentAction === "add-product") {
    return React.createElement(AddProductScreen, {
      currentStep: formStep,
      formData,
      inputValue,
      onSubmit: () => {},
      onCancel: () => {},
    });
  }

  if (appState === "input" && currentAction === "scrape") {
    return React.createElement(ScrapeScreen, {
      stage: "input",
      inputValue,
      onSubmit: () => {},
      onCancel: () => {},
    });
  }

  if (appState === "menu" || appState === "input") {
    return React.createElement(MenuScreen, {
      onSelect: executeAction,
      mode: appState === "input" ? "input" : "browse",
      selectedIndex,
      inputValue,
      inputPrompt: currentAction === "add-product"
        ? (FORM_PROMPTS[formStep] ?? "")
        : (currentMenuItem?.inputPrompt ?? ""),
      items: visibleMenuItems,
    });
  }

  if (appState === "running") {
    if (currentAction === "scrape") {
      return React.createElement(ScrapeScreen, {
        stage: "running",
        inputValue: scrapeUrl,
        progress: runProgress,
        onSubmit: () => {},
        onCancel: () => {},
      });
    }
    if (runProgress.generate) {
      return React.createElement(GenerateScreen, { progress: runProgress });
    }
    if (currentAction === "launch") {
      return React.createElement(LaunchScreen, { progress: runProgress });
    }
    if (currentAction === "improve") {
      return React.createElement(ImproveScreen, { progress: runProgress });
    }
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

  if (appState === "monitor") {
    return React.createElement(MonitorScreen, { onBack: () => setAppState("menu") });
  }

  if (appState === "review") {
    const applyReview = async (
      variantGroupId: string,
      creativeId: string,
      decision: Parameters<typeof applyReviewDecision>[1],
    ) => {
      let updated: Creative | null = null;
      const next = reviewGroups.map((g) => {
        if (g.variantGroupId !== variantGroupId) return g;
        return {
          ...g,
          creatives: g.creatives.map((c) => {
            if (c.id !== creativeId || c.status !== "pending") return c;
            updated = applyReviewDecision(c, decision);
            return updated;
          }),
        };
      });
      if (!updated) return next;
      await writeJson(`data/creatives/${creativeId}.json`, updated);
      setReviewGroups(next);
      return next;
    };

    return React.createElement(ReviewScreen, {
      groups: reviewGroups,
      onApprove: async (variantGroupId: string, creativeId: string) => {
        const next = await applyReview(variantGroupId, creativeId, { action: "approve" });
        if (next.every((g) => g.creatives.every((c) => c.status !== "pending"))) {
          setDoneResult({
            success: true,
            message: "Review 완료",
            logs: [`${next.length}개 그룹 검토 완료`],
          });
          setAppState("done");
        }
      },
      onReject: async (variantGroupId: string, creativeId: string, note: string) => {
        await applyReview(variantGroupId, creativeId, { action: "reject", note });
      },
      onEdit: async (variantGroupId: string, creativeId: string, field: keyof Creative["copy"], value: string) => {
        await applyReview(variantGroupId, creativeId, { action: "edit", field, value });
      },
    });
  }

  return null;
}
