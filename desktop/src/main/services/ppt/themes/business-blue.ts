import type { Theme } from "../types";

export const businessBlue: Theme = {
  id: "business-blue",
  name: "商务蓝",
  description: "适用于工作汇报、经营分析、商务提案",
  colors: {
    primary: "#1e3a5f",
    secondary: "#4a90d9",
    accent: "#f5a623",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#1a1a2e",
    textLight: "#64748b",
    textOnPrimary: "#ffffff",
    success: "#10b981",
    danger: "#ef4444",
  },
  fonts: {
    title: { face: "Microsoft YaHei", size: 36, bold: true, color: "#1e3a5f" },
    subtitle: { face: "Microsoft YaHei", size: 20, bold: false, color: "#64748b" },
    heading: { face: "Microsoft YaHei", size: 28, bold: true, color: "#1a1a2e" },
    body: { face: "Microsoft YaHei", size: 16, bold: false, color: "#1a1a2e" },
    caption: { face: "Microsoft YaHei", size: 12, bold: false, color: "#94a3b8" },
    metric: { face: "Arial", size: 48, bold: true, color: "#1e3a5f" },
  },
  cssVariables: `
    --color-primary: #1e3a5f;
    --color-secondary: #4a90d9;
    --color-accent: #f5a623;
    --color-bg: #ffffff;
    --color-surface: #f8fafc;
    --color-text: #1a1a2e;
    --color-text-light: #64748b;
    --color-text-on-primary: #ffffff;
    --color-success: #10b981;
    --color-danger: #ef4444;
    --font-main: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    --font-metric: "DIN Alternate", "Arial Black", Arial, sans-serif;
  `,
};
