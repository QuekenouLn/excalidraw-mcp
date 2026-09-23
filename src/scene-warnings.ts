import { getBoundTextWidthViolations } from "./server-element-conversion.js";

const PSEUDO_TYPES = new Set(["cameraUpdate", "delete", "restoreCheckpoint"]);
const OVERLAP_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "iframe",
]);

export type SceneWarningType =
  | "overlap"
  | "unbound-arrow"
  | "bound-text-overflow";

export type OverlapWarning = {
  type: "overlap";
  a: string;
  b: string;
  deficit: number;
};

export type UnboundArrowWarning = {
  type: "unbound-arrow";
  id: string;
  missing: Array<"start" | "end">;
};

export type BoundTextOverflowWarning = {
  type: "bound-text-overflow";
  textId: string;
  containerId: string;
  requiredWidth: number;
  availableWidth: number;
  deficit: number;
};

export type SceneWarning =
  | OverlapWarning
  | UnboundArrowWarning
  | BoundTextOverflowWarning;

type Box = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isLiveElement = (element: any): boolean =>
  Boolean(element) &&
  element.isDeleted !== true &&
  typeof element.type === "string" &&
  !PSEUDO_TYPES.has(element.type);

const liveId = (element: any): string | null =>
  typeof element?.id === "string" && element.id.length > 0 ? element.id : null;

const toBox = (element: any): Box | null => {
  const id = liveId(element);
  if (
    !id ||
    !isFiniteNumber(element.x) ||
    !isFiniteNumber(element.y) ||
    !isFiniteNumber(element.width) ||
    !isFiniteNumber(element.height)
  ) {
    return null;
  }
  return {
    id,
    left: element.x,
    top: element.y,
    right: element.x + element.width,
    bottom: element.y + element.height,
  };
};

const overlapDeficit = (left: Box, right: Box): number => {
  const overlapX = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const overlapY =
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  if (overlapX <= 0 || overlapY <= 0) {
    return 0;
  }
  return Math.min(overlapX, overlapY);
};

const collectOverlapWarnings = (elements: any[]): OverlapWarning[] => {
  const boxes = elements
    .filter((element) => OVERLAP_TYPES.has(element.type))
    .map(toBox)
    .filter((box): box is Box => box !== null);
  const warnings: OverlapWarning[] = [];

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const deficit = overlapDeficit(boxes[i], boxes[j]);
      if (deficit <= 0) {
        continue;
      }
      const [a, b] = [boxes[i].id, boxes[j].id].sort();
      warnings.push({ type: "overlap", a, b, deficit });
    }
  }

  return warnings;
};

const bindingTargetId = (binding: unknown): string | null => {
  if (!binding || typeof binding !== "object") {
    return null;
  }
  const record = binding as { elementId?: unknown; id?: unknown };
  if (typeof record.elementId === "string" && record.elementId.length > 0) {
    return record.elementId;
  }
  if (typeof record.id === "string" && record.id.length > 0) {
    return record.id;
  }
  return null;
};

const collectUnboundArrowWarnings = (
  elements: any[],
  liveIds: ReadonlySet<string>,
): UnboundArrowWarning[] =>
  elements.flatMap((element) => {
    if (element.type !== "arrow") {
      return [];
    }
    const id = liveId(element);
    if (!id) {
      return [];
    }
    const missing: Array<"start" | "end"> = [];
    const startId = bindingTargetId(element.startBinding);
    const endId = bindingTargetId(element.endBinding);
    if (!startId || !liveIds.has(startId)) {
      missing.push("start");
    }
    if (!endId || !liveIds.has(endId)) {
      missing.push("end");
    }
    return missing.length > 0 ? [{ type: "unbound-arrow", id, missing }] : [];
  });

const collectBoundTextOverflowWarnings = (
  elements: any[],
): BoundTextOverflowWarning[] =>
  getBoundTextWidthViolations(elements).map((violation) => ({
    type: "bound-text-overflow",
    textId: violation.textId,
    containerId: violation.containerId,
    requiredWidth: violation.requiredWidth,
    availableWidth: violation.availableWidth,
    deficit: violation.deficit,
  }));

export const collectSceneWarnings = (elements: readonly any[]): SceneWarning[] => {
  const live = elements.filter(isLiveElement);
  const liveIds = new Set(
    live.map(liveId).filter((id): id is string => id !== null),
  );
  return [
    ...collectOverlapWarnings(live),
    ...collectUnboundArrowWarnings(live, liveIds),
    ...collectBoundTextOverflowWarnings(live),
  ];
};

const WARNING_ORDER: SceneWarningType[] = [
  "overlap",
  "unbound-arrow",
  "bound-text-overflow",
];

export const formatWarningCounts = (warnings: readonly SceneWarning[]): string => {
  if (warnings.length === 0) {
    return "No warnings.";
  }
  const counts = new Map<SceneWarningType, number>();
  for (const warning of warnings) {
    counts.set(warning.type, (counts.get(warning.type) ?? 0) + 1);
  }
  const parts = WARNING_ORDER.flatMap((type) => {
    const count = counts.get(type);
    return count ? [`${count} ${type}`] : [];
  });
  return `Warnings: ${parts.join(", ")}.`;
};

export const formatCreateViewResultText = (
  checkpointId: string,
  warnings: readonly SceneWarning[],
  ratioHint = "",
): string =>
  `Checkpoint "${checkpointId}". ${formatWarningCounts(warnings)}${ratioHint}`;

export const formatSaveRemoteFileResultText = (
  name: string,
  revision: string,
  checkpointId: string,
  warnings: readonly SceneWarning[],
): string =>
  `Saved ${name} at revision ${revision}. Checkpoint "${checkpointId}". ${formatWarningCounts(warnings)}`;
