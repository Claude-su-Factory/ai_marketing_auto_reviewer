export const colors = {
  bg:        "#1a1b26",
  fg:        "#c0caf5",
  dim:       "#565f89",
  accent:    "#7aa2f7",
  success:   "#9ece6a",
  warning:   "#e0af68",
  danger:    "#f7768e",
  review:    "#bb9af7",
  analytics: "#7dcfff",
} as const;

export const border = { borderStyle: "round" as const, borderColor: colors.review };

export const icons = {
  success: "✓",
  running: "⟳",
  pending: "○",
  failure: "✗",
  header:  "◆",
  bullet:  "●",
  select:  "▶",
  up:      "▲",
  down:    "▼",
} as const;
