import type { ClusterResourceAddress } from "@cluster/shared";
import type { Card } from "./projects";
import type { LocalComment } from "./workflow-access";

export type WhiteboardTool = "select" | "pen" | "line" | "arrow" | "box" | "ellipse" | "diamond" | "sticky" | "process" | "terminator" | "database" | "cloud" | "actor" | "frame" | "callout" | "swimlane" | "card" | "text" | "eraser";

export type WhiteboardPoint = { x: number; y: number; pressure?: number };

export type WhiteboardShapeType = "box" | "ellipse" | "diamond" | "sticky" | "process" | "terminator" | "database" | "cloud" | "actor" | "frame" | "callout" | "swimlane";

export type WhiteboardPathElement = {
  id: string;
  type: "path";
  points: WhiteboardPoint[];
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  dashed?: boolean;
  categoryId?: string | null;
  labelIds?: string[];
  locked?: boolean;
};

export type WhiteboardShapeElement = {
  id: string;
  type: WhiteboardShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
  textColor: string;
  opacity?: number;
  dashed?: boolean;
  shadow?: boolean;
  /** Frames marked as sections are navigable workspace regions, while remaining normal frame elements. */
  section?: boolean;
  categoryId?: string | null;
  labelIds?: string[];
  locked?: boolean;
};

export type WhiteboardConnectorElement = {
  id: string;
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text: string;
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  dashed?: boolean;
  /** Optional durable element anchors used by smart connectors. */
  fromId?: string | null;
  toId?: string | null;
  categoryId?: string | null;
  labelIds?: string[];
  locked?: boolean;
};

export type WhiteboardTextElement = {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  stroke: string;
  fontSize: number;
  categoryId?: string | null;
  labelIds?: string[];
  locked?: boolean;
};

export type WhiteboardImageElement = {
  id: string;
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  alt: string;
  originalName?: string;
  opacity?: number;
  categoryId?: string | null;
  labelIds?: string[];
  locked?: boolean;
};

export type WhiteboardCardElement = {
  id: string;
  type: "card";
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  text: string;
  accent: string;
  fill: string;
  textColor: string;
  opacity?: number;
  categoryId?: string | null;
  labelIds?: string[];
  locked?: boolean;
  /** Canonical Cluster resource identity for live-reference cards. Content remains owned by the referenced domain. */
  resource?: ClusterResourceAddress | null;
  resourceKindLabel?: string | null;
  resourceStatus?: string | null;
  resourceDetail?: string | null;
  resourceUpdatedAt?: string | null;
};

export type WhiteboardElement = (WhiteboardPathElement | WhiteboardShapeElement | WhiteboardConnectorElement | WhiteboardTextElement | WhiteboardImageElement | WhiteboardCardElement) & {
  /** Optional user-defined grouping. Stored inside the existing whiteboard element JSON payload. */
  groupId?: string | null;
};

export type WhiteboardProductionRecord = {
  elementId: string;
  reviewState: "draft" | "in-review" | "approved" | "needs-update";
  comments?: LocalComment[];
  updatedAt: string;
};

export type WhiteboardInteraction =
  | { mode: "create"; id: string; start: WhiteboardPoint }
  | {
      mode: "move";
      id: string;
      start: WhiteboardPoint;
      original: WhiteboardElement;
      originals?: WhiteboardElement[];
    }
  | { mode: "erase" };

export type TicketCard = Card & {
  boardName: string;
  projectName: string;
  listTitle: string;
  listIsDone?: boolean;
  boardId: string;
  projectId: string;
};
