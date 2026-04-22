export type AppState = "menu" | "input" | "running" | "done" | "review" | "monitor";

export interface TaskProgress {
  copy: number;    // 0-100
  image: number;   // 0-100
  video: number;   // 0-100
}

export interface RunProgress {
  message: string;
  currentCourse?: string;
  courseIndex?: number;
  totalCourses?: number;
  taskProgress?: TaskProgress;
  generate?: GenerateProgress;
  launchLogs?: LaunchLog[];
}

export type ProgressCallback = (p: RunProgress) => void;

export interface DoneResult {
  success: boolean;
  message: string;
  logs: string[];
}

export type ActionKey =
  | "scrape"
  | "add-product"
  | "generate"
  | "review"
  | "launch"
  | "monitor"
  | "improve"
  | "pipeline";

export interface MenuItem {
  key: ActionKey;
  label: string;
  description: string;
  needsInput: boolean;
  inputPrompt?: string;
}

export const MENU_ITEMS: MenuItem[] = [
  { key: "scrape",       label: "Scrape",      description: "강의 정보 수집",      needsInput: true,  inputPrompt: "URL 입력 (Enter 확정):" },
  { key: "add-product",  label: "Add Product", description: "제품 수동 입력",      needsInput: false },
  { key: "generate",     label: "Generate",    description: "소재 생성",            needsInput: false },
  { key: "review",   label: "Review",   description: "검토·승인",            needsInput: false },
  { key: "launch",   label: "Launch",   description: "광고 게재",            needsInput: false },
  { key: "monitor",  label: "Monitor",  description: "성과 분석",            needsInput: false },
  { key: "improve",  label: "Improve",  description: "자율 개선",            needsInput: false },
  { key: "pipeline", label: "Pipeline", description: "전체 파이프라인 실행", needsInput: true,  inputPrompt: "URL 입력 (공백으로 구분, Enter 확정):" },
];

export interface GenerateProgress {
  queue: ("done" | "running" | "pending")[];
  currentProduct: { id: string; name: string };
  tracks: {
    copy:  { status: "pending" | "running" | "done"; pct: number; label: string };
    image: { status: "pending" | "running" | "done"; pct: number; label: string };
    video: { status: "pending" | "running" | "done"; pct: number; label: string };
  };
  elapsedMs: number;
}

export interface LaunchLog {
  ts: string;
  method: string;
  path: string;
  status: number;
  refId?: string;
}
