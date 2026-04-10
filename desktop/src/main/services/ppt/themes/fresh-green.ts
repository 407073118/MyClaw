import type { Theme } from "../types";

export const freshGreen: Theme = {
  id: "fresh-green",
  name: "清新绿",
  description: "适用于培训分享、知识传递、团队协作演示",
  colors: {
    primary: "#059669",
    secondary: "#34d399",
    accent: "#f59e0b",
    background: "#ffffff",
    surface: "#f0fdf4",
    text: "#1a1a2e",
    textLight: "#6b7280",
    textOnPrimary: "#ffffff",
    success: "#10b981",
    danger: "#ef4444",
  },
  fonts: {
    title: { face: "Microsoft YaHei", size: 36, bold: true, color: "#059669" },
    subtitle: { face: "Microsoft YaHei", size: 20, bold: false, color: "#6b7280" },
    heading: { face: "Microsoft YaHei", size: 28, bold: true, color: "#1a1a2e" },
    body: { face: "Microsoft YaHei", size: 16, bold: false, color: "#1a1a2e" },
    caption: { face: "Microsoft YaHei", size: 12, bold: false, color: "#9ca3af" },
    metric: { face: "Arial", size: 48, bold: true, color: "#059669" },
  },
  cssVariables: `
    --color-primary: #059669;
    --color-secondary: #34d399;
    --color-accent: #f59e0b;
    --color-bg: #ffffff;
    --color-surface: #f0fdf4;
    --color-text: #1a1a2e;
    --color-text-light: #6b7280;
    --color-text-on-primary: #ffffff;
    --color-success: #10b981;
    --color-danger: #ef4444;
    --font-main: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    --font-metric: "DIN Alternate", "Arial Black", Arial, sans-serif;
  `,
};
