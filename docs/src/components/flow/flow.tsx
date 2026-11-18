"use client";

import {
  Background,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";

/** What a box is. It only changes the colour, so a diagram reads at a glance. */
export type FlowKind = "unit" | "feature" | "store" | "external" | "group" | "process";

export type FlowNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  kind?: FlowKind;
  /** Second line under the label (a path, a protocol, a count). */
  sub?: string;
  /** Shown under the diagram when the box is clicked: say what it is and why it is there. */
  desc?: string;
  width?: number;
};

export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
  /** Dashed = asynchronous or optional (events, remote calls that only exist in some topologies). */
  dashed?: boolean;
  animated?: boolean;
};

export type FlowProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** LR: arrows leave a box on its right; TB: on its bottom. */
  direction?: "LR" | "TB";
  height?: number;
  /** A line above the diagram that says what to look at. */
  caption?: string;
};

type BoxData = {
  label: string;
  sub?: string;
  kind: FlowKind;
  direction: "LR" | "TB";
  active: boolean;
  dimmed: boolean;
};

const KIND_STYLE: Record<FlowKind, { bg: string; border: string }> = {
  unit: { bg: "color-mix(in oklab, var(--color-fd-primary) 12%, var(--color-fd-card))", border: "var(--color-fd-primary)" },
  feature: { bg: "color-mix(in oklab, #10b981 14%, var(--color-fd-card))", border: "#10b981" },
  store: { bg: "color-mix(in oklab, #f59e0b 14%, var(--color-fd-card))", border: "#f59e0b" },
  external: { bg: "var(--color-fd-muted)", border: "var(--color-fd-border)" },
  process: { bg: "color-mix(in oklab, #8b5cf6 14%, var(--color-fd-card))", border: "#8b5cf6" },
  group: { bg: "transparent", border: "var(--color-fd-border)" },
};

function Box({ data }: NodeProps<Node<BoxData>>) {
  const k = KIND_STYLE[data.kind];
  const target = data.direction === "LR" ? Position.Left : Position.Top;
  const source = data.direction === "LR" ? Position.Right : Position.Bottom;
  const style: CSSProperties = {
    background: k.bg,
    borderColor: data.active ? "var(--color-fd-foreground)" : k.border,
    borderStyle: data.kind === "group" ? "dashed" : "solid",
    opacity: data.dimmed ? 0.35 : 1,
    color: "var(--color-fd-foreground)",
  };
  return (
    <div className="rounded-lg border-2 px-3 py-2 text-center text-sm leading-tight transition-opacity" style={style}>
      <Handle type="target" position={target} style={{ opacity: 0 }} />
      <div className="font-semibold">{data.label}</div>
      {data.sub ? <div className="mt-0.5 text-xs text-fd-muted-foreground">{data.sub}</div> : null}
      <Handle type="source" position={source} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { box: Box };

const FLOW_VARS = {
  "--xy-edge-stroke-default": "var(--color-fd-muted-foreground)",
  "--xy-edge-stroke-selected-default": "var(--color-fd-foreground)",
  "--xy-background-color-default": "transparent",
  "--xy-attribution-background-color-default": "transparent",
  "--xy-node-border-radius-default": "8px",
} as CSSProperties;

function Diagram({ nodes, edges, direction = "LR", height = 360, caption }: FlowProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  // fitView on mount runs before the container has its final size (and the sidebar or window can
  // change it later), so re-fit whenever the container is resized.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const refit = () => void fitView({ padding: 0.12, duration: 0 });
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    refit();
    return () => ro.disconnect();
  }, [fitView]);

  const connected = useMemo(() => {
    if (!selected) return null;
    const ids = new Set<string>([selected]);
    for (const e of edges) {
      if (e.from === selected) ids.add(e.to);
      if (e.to === selected) ids.add(e.from);
    }
    return ids;
  }, [selected, edges]);

  const rfNodes: Node<BoxData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "box",
        position: { x: n.x, y: n.y },
        width: n.width ?? 170,
        data: {
          label: n.label,
          sub: n.sub,
          kind: n.kind ?? "unit",
          direction,
          active: selected === n.id,
          dimmed: connected !== null && !connected.has(n.id),
        },
        draggable: false,
        selectable: true,
      })),
    [nodes, direction, selected, connected],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e, i) => {
        const on = selected !== null && (e.from === selected || e.to === selected);
        return {
          id: `${e.from}-${e.to}-${i}`,
          source: e.from,
          target: e.to,
          label: e.label,
          animated: e.animated ?? false,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            strokeDasharray: e.dashed ? "6 4" : undefined,
            strokeWidth: on ? 2.5 : 1.5,
            opacity: selected !== null && !on ? 0.2 : 1,
          },
          labelStyle: { fill: "var(--color-fd-foreground)", fontSize: 12 },
          labelBgStyle: { fill: "var(--color-fd-background)", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
        };
      }),
    [edges, selected],
  );

  const detail = nodes.find((n) => n.id === selected);

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card">
      {caption ? <figcaption className="border-b px-4 py-2 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
      <div ref={wrap} style={{ height, ...FLOW_VARS }} role="img" aria-label={caption ?? "Diagram"}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setSelected((cur) => (cur === n.id ? null : n.id))}
          // The pane wraps the nodes, so a node click also reaches it: clear only on empty background.
          onPaneClick={(e) => {
            if (!(e.target as Element).closest(".react-flow__node")) setSelected(null);
          }}
        >
          <Background gap={20} size={1} />
        </ReactFlow>
      </div>
      <div className="min-h-10 border-t px-4 py-2 text-sm">
        {detail ? (
          <>
            <span className="font-semibold">{detail.label}.</span>{" "}
            <span className="text-fd-muted-foreground">{detail.desc ?? "Click the background to clear the selection."}</span>
          </>
        ) : (
          <span className="text-fd-muted-foreground">Click a box to see what it is and follow its arrows.</span>
        )}
      </div>
    </figure>
  );
}

/** Interactive diagram: boxes and arrows laid out by hand, click a box to follow its connections. */
export function Flow(props: FlowProps) {
  return (
    <ReactFlowProvider>
      <Diagram {...props} />
    </ReactFlowProvider>
  );
}
