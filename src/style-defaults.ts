export const MCP_DEFAULT_FONT_FAMILY = 11;

const ADAPTIVE_SOFT_TYPES = new Set([
  "rectangle",
  "image",
  "iframe",
  "embeddable",
]);
const PROPORTIONAL_SOFT_TYPES = new Set(["diamond", "line", "arrow"]);
const STROKED_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "image",
  "iframe",
  "embeddable",
]);

export const isCompleteNativeElement = (element: any): boolean => {
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

  if (
    typeof element.version !== "number" ||
    typeof element.versionNonce !== "number" ||
    !isFiniteNumber(element.x) ||
    !isFiniteNumber(element.y) ||
    !isFiniteNumber(element.width) ||
    !isFiniteNumber(element.height)
  ) {
    return false;
  }

  return (
    element.type !== "text" ||
    (typeof element.text === "string" &&
      isFiniteNumber(element.fontSize) &&
      isFiniteNumber(element.fontFamily) &&
      isFiniteNumber(element.lineHeight))
  );
};

export const applyMcpTextAlignment = (element: any): any => {
  if (element.type === "text") {
    return {
      ...element,
      textAlign: "center",
    };
  }

  if (element.label) {
    return {
      ...element,
      label: {
        ...element.label,
        textAlign: "center",
      },
    };
  }

  return element;
};

export const applyMcpStyleDefaults = (element: any): any => {
  if (isCompleteNativeElement(element)) {
    return element;
  }

  const styled = { ...element };

  if (STROKED_TYPES.has(styled.type) && !Object.hasOwn(styled, "strokeWidth")) {
    styled.strokeWidth = 1;
  } else if (
    styled.type === "freedraw" &&
    !Object.hasOwn(styled, "strokeWidth")
  ) {
    styled.strokeWidth = 0.5;
  }

  if (!Object.hasOwn(styled, "roundness")) {
    if (styled.type === "arrow" && styled.elbowed) {
      styled.roundness = null;
    } else if (ADAPTIVE_SOFT_TYPES.has(styled.type)) {
      styled.roundness = { type: 3, value: 12 };
    } else if (PROPORTIONAL_SOFT_TYPES.has(styled.type)) {
      styled.roundness = { type: 2, value: 0.1 };
    }
  }

  if (styled.type === "text" && !Object.hasOwn(styled, "fontFamily")) {
    styled.fontFamily = MCP_DEFAULT_FONT_FAMILY;
  }

  if (styled.label && !Object.hasOwn(styled.label, "fontFamily")) {
    styled.label = {
      ...styled.label,
      fontFamily: MCP_DEFAULT_FONT_FAMILY,
    };
  }

  return styled;
};
