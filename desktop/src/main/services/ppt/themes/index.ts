import type { Theme } from "../types";
import { businessBlue } from "./business-blue";
import { techDark } from "./tech-dark";
import { freshGreen } from "./fresh-green";

const THEMES: Theme[] = [businessBlue, techDark, freshGreen];

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export function listThemeSummaries() {
  return THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    colors: {
      primary: t.colors.primary,
      secondary: t.colors.secondary,
      accent: t.colors.accent,
      background: t.colors.background,
    },
  }));
}
