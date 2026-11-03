/**
 * Light / dark chart colors.
 * Chart libraries draw SVG with plain color values, so we pick the palette in JS
 * (CSS variables can't be relied on inside SVG attributes).
 */
import { useEffect, useState } from "react";

// Categorical palette, fixed order (validated for colour-blind separation of neighbours).
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export interface ChartTheme {
  series: string[];
  surface: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
}

const LIGHT: ChartTheme = {
  series: SERIES_LIGHT,
  surface: "#ffffff",
  text: "#0f1222",
  muted: "#868ca3",
  grid: "#e6e8f1",
  axis: "#c9cde0",
};

const DARK: ChartTheme = {
  series: SERIES_DARK,
  surface: "#111527",
  text: "#eef0fa",
  muted: "#7c829c",
  grid: "#22284a",
  axis: "#2f365c",
};

export function useChartTheme(): ChartTheme {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return dark ? DARK : LIGHT;
}
