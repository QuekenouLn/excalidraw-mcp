import {
  convertToExcalidrawElements,
  FONT_FAMILY,
  restoreElements,
} from "@excalidraw/excalidraw";
import {
  applyMcpStyleDefaults,
  applyMcpTextAlignment,
  isCompleteNativeElement,
  MCP_DEFAULT_FONT_FAMILY,
} from "./style-defaults";

(FONT_FAMILY as any)["Maple Mono NF CN"] = MCP_DEFAULT_FONT_FAMILY;

export function refreshRestoredElements(elements: any[]): any[] {
  const restored = restoreElements(
    elements,
    null,
    { refreshDimensions: true, repairBindings: true },
  );
  const elementsMap = new Map(
    restored.map((element) => [element.id, element]),
  ) as any;

  return restored.map((element) => {
    if (element.type !== "text" || !element.containerId) {
      return element;
    }
    const container = elementsMap.get(element.containerId);
    if (!container) {
      return element;
    }
    if (container.type === "arrow") {
      return element;
    }
    return {
      ...element,
      x: container.x + (container.width - element.width) / 2,
      y: container.y + (container.height - element.height) / 2,
    };
  });
}

export function convertRawElements(
  elements: any[],
  { centerNewText = true }: { centerNewText?: boolean } = {},
): any[] {
  const pseudoTypes = new Set([
    "cameraUpdate",
    "delete",
    "restoreCheckpoint",
  ]);
  const pseudos = elements.filter((element) => pseudoTypes.has(element.type));
  const real = elements.filter((element) => !pseudoTypes.has(element.type));
  const isNativeScene = real.every(isCompleteNativeElement);
  if (isNativeScene) {
    return [
      ...(centerNewText ? real.map(applyMcpTextAlignment) : real),
      ...pseudos,
    ];
  }

  const withDefaults = real.map((input) => {
    const element = applyMcpStyleDefaults(input);
    const normalized =
      element.type === "arrow"
        ? normalizeArrowBindings(element)
        : element;
    return normalized.label
      ? {
          ...normalized,
          label: {
            textAlign: "center",
            verticalAlign: "middle",
            ...normalized.label,
          },
        }
      : normalized;
  });
  const converted = convertToExcalidrawElements(withDefaults, {
    regenerateIds: false,
  });
  return [
    ...(centerNewText ? converted.map(applyMcpTextAlignment) : converted),
    ...pseudos,
  ];
}

function normalizeArrowBindings(element: any): any {
  const { startBinding, endBinding, boundElements, ...arrow } = element;
  return {
    ...arrow,
    roundness: arrow.roundness,
    start:
      arrow.start ??
      (startBinding?.elementId ? { id: startBinding.elementId } : undefined),
    end:
      arrow.end ??
      (endBinding?.elementId ? { id: endBinding.elementId } : undefined),
  };
}
