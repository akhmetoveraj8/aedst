"use client";

import { cn } from "cn";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsCoreOption } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as React from "react";

// Tree-shaken ECharts: only the chart types, components and renderer the kit
// exposes are bundled. Add a chart type here (and to the kit docs) before using it.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  AriaComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const SERIES_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
] as const;

export type ChartOption = EChartsCoreOption;

export type ChartTheme = {
  /** Series palette, resolved from `--chart-1..5`. */
  palette: string[];
  /** Axis labels and legend text (`--muted-foreground`). */
  text: string;
  /** Grid and axis lines (`--border`). */
  line: string;
  /** Tooltip surface (`--popover`) and its text (`--popover-foreground`). */
  surface: string;
  surfaceText: string;
};

// Canvas cannot paint `var()` and zrender cannot parse `oklch()`, so every
// token is flattened to an rgb() string through a 1x1 canvas.
function toRgb(cssColor: string): string {
  if (typeof document === "undefined") return cssColor;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return cssColor;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const data = context.getImageData(0, 0, 1, 1).data;
  const [r = 0, g = 0, b = 0, a = 255] = data;
  return a === 255
    ? `rgb(${r} ${g} ${b})`
    : `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;
}

function readToken(style: CSSStyleDeclaration, token: string): string {
  return toRgb(style.getPropertyValue(token).trim());
}

function readTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  return {
    palette: SERIES_TOKENS.map((token) => readToken(style, token)),
    text: readToken(style, "--muted-foreground"),
    line: readToken(style, "--border"),
    surface: readToken(style, "--popover"),
    surfaceText: readToken(style, "--popover-foreground"),
  };
}

/**
 * The kit palette as resolved colors; re-read when the theme class or
 * attributes of `<html>` change (next-themes, light/dark). `null` until mounted.
 */
function useChartTheme(): ChartTheme | null {
  const [theme, setTheme] = React.useState<ChartTheme | null>(null);

  React.useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function withTheme(option: ChartOption, theme: ChartTheme): ChartOption {
  return {
    color: theme.palette,
    backgroundColor: "transparent",
    textStyle: { color: theme.text, fontFamily: "inherit" },
    // The accessible description of the data (aria-label from the series).
    aria: { enabled: true },
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      textStyle: { color: theme.surfaceText, fontSize: 12 },
    },
    legend: { textStyle: { color: theme.text } },
    ...option,
  };
}

export type ChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Standard ECharts option (series, axes, dataset). Colors default to the kit palette. */
  option: ChartOption;
  /** Accessible name of the chart, required: a canvas has no text content. */
  "aria-label": string;
  /** Pixel height of the plot; the width follows the container. */
  height?: number;
};

/**
 * The only chart component of the web clients: Apache ECharts on canvas, themed
 * from the design tokens. Feature code passes an `option`; it never imports
 * `echarts` directly (`task check:ui-kit-only`).
 */
function Chart({
  option,
  height = 240,
  className,
  style,
  ...props
}: ChartProps) {
  const theme = useChartTheme();
  const themed = React.useMemo(
    () => (theme ? withTheme(option, theme) : null),
    [option, theme],
  );

  return (
    <div
      data-slot="chart"
      role="img"
      className={cn("w-full text-xs", className)}
      style={{ height, ...style }}
      {...props}
    >
      {themed ? (
        <ReactEChartsCore
          echarts={echarts}
          option={themed}
          notMerge
          lazyUpdate
          style={{ height: "100%", width: "100%" }}
        />
      ) : null}
    </div>
  );
}

export { Chart };
