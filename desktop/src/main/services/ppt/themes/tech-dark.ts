import type { Theme } from "../types";

export const techDark: Theme = {
  id: "tech-dark",
  name: "科技暗色",
  description: "适用于技术方案、产品架构、系统设计演示",
  colors: {
    primary: "#3b82f6",
    secondary: "#8b5cf6",
    accent: "#22d3ee",
    background: "#0f172a",
    surface: "#1e293b",
    text: "#f1f5f9",
    textLight: "#94a3b8",
    textOnPrimary: "#ffffff",
    success: "#34d399",
    danger: "#f87171",
  },
  fonts: {
    title: { face: "Microsoft YaHei", size: 36, bold: true, color: "#f1f5f9" },
    subtitle: { face: "Microsoft YaHei", size: 20, bold: false, color: "#94a3b8" },
    heading: { face: "Microsoft YaHei", size: 28, bold: true, color: "#f1f5f9" },
    body: { face: "Microsoft YaHei", size: 16, bold: false, color: "#e2e8f0" },
    caption: { face: "Microsoft YaHei", size: 12, bold: false, color: "#64748b" },
    metric: { face: "Arial", size: 48, bold: true, color: "#3b82f6" },
  },
  cssVariables: `
    --color-primary: #3b82f6;
    --color-secondary: #8b5cf6;
    --color-accent: #22d3ee;
    --color-bg: #0f172a;
    --color-surface: #1e293b;
    --color-text: #f1f5f9;
    --color-text-light: #94a3b8;
    --color-text-on-primary: #ffffff;
    --color-success: #34d399;
    --color-danger: #f87171;
    --font-main: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    --font-metric: "DIN Alternate", "Arial Black", Arial, sans-serif;
  `,
};
