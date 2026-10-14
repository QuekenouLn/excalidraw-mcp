import {
  positionNativeArrowLabel,
  routeNativeElbowArrow,
} from "./native-derived-geometry.js";
import {
  applyMcpStyleDefaults,
  applyMcpTextAlignment,
  isCompleteNativeElement,
} from "./style-defaults.js";
import {
  hasMapleFontMetrics,
  measureMapleTextWidth,
} from "./maple-font-metrics.js";

const PSEUDO_TYPES = new Set(["cameraUpdate", "delete", "restoreCheckpoint"]);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const TEXT_HORIZONTAL_SAFETY_PADDING = 8;

export function convertElementsForStorage(
  elements: any[],
  bindingTargets: any[] = [],
  indexOffset = 0,
): any[] {
  const alignedElements = elements.map((element) =>
    PSEUDO_TYPES.has(element.type) ? element : applyMcpTextAlignment(element),
  );
  const real = alignedElements.filter(
    (element) => !PSEUDO_TYPES.has(element.type),
  );
  if (real.length > 0 && real.every(isCompleteNativeElement)) {
    const normalizedElements = normalizeNativeBoundTextWidths(
      alignedElements,
      bindingTargets,
    );
    const centeredElements = centerBoundTextElements(
      normalizedElements,
      bindingTargets,
    );
    return centeredElements.every(
      (element, index) => element === elements[index],
    )
      ? elements
      : centeredElements;
  }

  const styledElements = alignedElements.map((element) =>
    PSEUDO_TYPES.has(element.type) ? element : applyMcpStyleDefaults(element),
  );
  const nativeElements = styledElements.map((element, index) =>
    PSEUDO_TYPES.has(element.type) || isCompleteNativeElement(element)
      ? element
      : createNativeElement(element, `a${indexOffset + index}`),
  );
  const byId = new Map(
    [...bindingTargets, ...nativeElements]
      .filter((element) => element.id)
      .map((element) => [element.id, element]),
  );
  const labels: any[] = [];

  for (const [index, input] of styledElements.entries()) {
    if (PSEUDO_TYPES.has(input.type)) {
      continue;
    }
    if (isCompleteNativeElement(input)) {
      continue;
    }
    const element = byId.get(input.id);
    if (!element) {
      continue;
    }

    if (input.label?.text) {
      expandContainerForLabel(element, input.label);
      const label = createBoundText(
        element,
        input.label,
        `${input.id}__label`,
        `a${indexOffset + nativeElements.length + labels.length}`,
      );
      labels.push(label);
      addBoundElement(element, { id: label.id, type: "text" });
    }

    if (input.type === "arrow") {
      bindArrowEndpoint(
        element,
        input.startBinding ?? input.start,
        "start",
        byId,
      );
      bindArrowEndpoint(element, input.endBinding ?? input.end, "end", byId);
      normalizeBoundArrowGeometry(element);
      if (element.elbowed) {
        Object.assign(element, routeNativeElbowArrow(element, byId));
      }
    }

    element.index = `a${indexOffset + index}`;
  }

  return centerBoundTextElements(
    [...nativeElements, ...labels],
    bindingTargets,
  );
}

export type BoundTextWidthViolation = {
  textId: string;
  containerId: string;
  requiredWidth: number;
  availableWidth: number;
  deficit: number;
};

export function getBoundTextWidthViolations(
  elements: any[],
  bindingTargets: any[] = [],
): BoundTextWidthViolation[] {
  const byId = new Map(
    [...bindingTargets, ...elements]
      .filter((element) => element.id)
      .map((element) => [element.id, element]),
  );

  return elements.flatMap((element) => {
    if (element.type !== "text" || !element.containerId) {
      return [];
    }
    const container = byId.get(element.containerId);
    if (!container || !isFiniteNumber(container.width)) {
      return [];
    }
    const requiredWidth = getRequiredBoundTextWidth(element);
    const availableWidth = getBoundTextMaxWidth(container);
    if (requiredWidth <= availableWidth + Number.EPSILON) {
      return [];
    }
    return [
      {
        textId: element.id,
        containerId: container.id,
        requiredWidth,
        availableWidth,
        deficit: requiredWidth - availableWidth,
      },
    ];
  });
}

function normalizeNativeBoundTextWidths(
  elements: any[],
  bindingTargets: any[],
): any[] {
  const byId = new Map(
    [...bindingTargets, ...elements]
      .filter((element) => element.id)
      .map((element) => [element.id, element]),
  );
  const replacements = new Map<string, any>();

  for (const violation of getBoundTextWidthViolations(
    elements,
    bindingTargets,
  )) {
    const text = byId.get(violation.textId);
    const container =
      replacements.get(violation.containerId) ??
      byId.get(violation.containerId);
    if (!text || !container || container.type === "arrow") {
      continue;
    }
    const requiredContainerWidth = getRequiredContainerWidth(
      container,
      violation.requiredWidth,
    );
    const centerX = container.x + container.width / 2;
    const normalizedContainer = {
      ...container,
      x: centerX - requiredContainerWidth / 2,
      width: requiredContainerWidth,
    };
    const normalizedText = {
      ...text,
      width: violation.requiredWidth,
    };
    replacements.set(container.id, normalizedContainer);
    replacements.set(text.id, normalizedText);
    byId.set(container.id, normalizedContainer);
    byId.set(text.id, normalizedText);
  }

  return replacements.size > 0
    ? elements.map((element) => replacements.get(element.id) ?? element)
    : elements;
}

function getRequiredBoundTextWidth(textElement: any): number {
  const fontSize = textElement.fontSize ?? 20;
  const lines = String(
    textElement.text ?? textElement.originalText ?? "",
  ).split("\n");
  return Math.max(
    ...lines.map(
      (line) =>
        measureLineWidth(line, fontSize) + TEXT_HORIZONTAL_SAFETY_PADDING,
    ),
    fontSize,
  );
}

function getRequiredContainerWidth(container: any, textWidth: number): number {
  if (container.type === "diamond") {
    return textWidth / 0.7;
  }
  if (container.type === "ellipse") {
    return textWidth / 0.75;
  }
  return textWidth + 10;
}

function createNativeElement(input: any, index: string): any {
  const { label, start, end, centerX, ...element } = input;
  const native = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index,
    roundness: null,
    seed: stableNumber(`${input.id}:seed`),
    version: 1,
    versionNonce: stableNumber(`${input.id}:nonce`),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...element,
  };

  if (input.type === "arrow") {
    native.roundness = input.elbowed === false ? input.roundness ?? null : null;
    native.points = input.points ?? [
      [0, 0],
      [input.width ?? 100, input.height ?? 0],
    ];
    native.startBinding = null;
    native.endBinding = null;
    native.startArrowhead = input.startArrowhead ?? null;
    native.endArrowhead =
      input.endArrowhead === undefined ? "arrow" : input.endArrowhead;
    native.elbowed = input.elbowed ?? true;
    native.moveMidPointsWithElement = input.moveMidPointsWithElement ?? false;
  }

  if (input.type === "text") {
    const fontSize = input.fontSize ?? 20;
    const text = String(input.text ?? "");
    const lines = text.split("\n");
    native.width = isFiniteNumber(input.width)
      ? input.width
      : Math.max(
          ...lines.map(
            (line) =>
              measureLineWidth(line, fontSize) + TEXT_HORIZONTAL_SAFETY_PADDING,
          ),
          fontSize,
        );
    if (!input.containerId && isFiniteNumber(centerX)) {
      native.x = centerX - native.width / 2;
    }
    native.height = isFiniteNumber(input.height)
      ? input.height
      : Math.max(lines.length, 1) * fontSize * (input.lineHeight ?? 1.2);
    native.text = text;
    native.fontSize = fontSize;
    native.fontFamily = input.fontFamily;
    native.textAlign = "center";
    native.verticalAlign = input.containerId
      ? "middle"
      : input.verticalAlign ?? "top";
    native.containerId = input.containerId ?? null;
    native.originalText = input.originalText ?? text;
    native.autoResize = input.autoResize ?? true;
    native.lineHeight = input.lineHeight ?? 1.2;
  }

  return native;
}

function createBoundText(
  container: any,
  label: any,
  id: string,
  index: string,
): any {
  const fontSize = label.fontSize ?? 20;
  const originalText = String(label.text);
  const maxWidth = getBoundTextMaxWidth(container);
  const text = wrapText(
    originalText,
    fontSize,
    Math.max(maxWidth - TEXT_HORIZONTAL_SAFETY_PADDING, fontSize),
  );
  const lines = text.split("\n");
  const width = Math.max(
    ...lines.map(
      (line) =>
        measureLineWidth(line, fontSize) + TEXT_HORIZONTAL_SAFETY_PADDING,
    ),
    fontSize,
  );
  const height = lines.length * fontSize * 1.2;
  return {
    id,
    type: "text",
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height,
    angle: 0,
    strokeColor:
      label.strokeColor ??
      (container.strokeColor === "transparent"
        ? "#1e1e1e"
        : container.strokeColor),
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: container.frameId ?? null,
    index,
    roundness: null,
    seed: stableNumber(`${id}:seed`),
    version: 1,
    versionNonce: stableNumber(`${id}:nonce`),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    text,
    fontSize,
    fontFamily: label.fontFamily,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: container.id,
    originalText,
    autoResize: true,
    lineHeight: 1.2,
  };
}

export function deriveBoundTextDimensions(
  textElement: any,
  container: any,
): { text: string; width: number; height: number } {
  const fontSize = textElement.fontSize ?? 20;
  const originalText = String(
    textElement.originalText ?? textElement.text ?? "",
  );
  const maxWidth = getBoundTextMaxWidth(container);
  const text = wrapText(
    originalText,
    fontSize,
    Math.max(maxWidth - TEXT_HORIZONTAL_SAFETY_PADDING, fontSize),
  );
  const lines = text.split("\n");
  return {
    text,
    width: Math.max(
      ...lines.map(
        (line) =>
          measureLineWidth(line, fontSize) + TEXT_HORIZONTAL_SAFETY_PADDING,
      ),
      fontSize,
    ),
    height:
      Math.max(lines.length, 1) * fontSize * (textElement.lineHeight ?? 1.2),
  };
}

function centerBoundTextElements(
  elements: any[],
  bindingTargets: any[],
): any[] {
  const sceneIds = new Set(elements.map((element) => element.id));
  const byId = new Map(
    [...bindingTargets, ...elements]
      .filter((element) => element.id)
      .map((element) => [element.id, element]),
  );
  const replacements = new Map<string, any>();

  for (const element of elements) {
    if (element.type !== "text" || !element.containerId) {
      continue;
    }
    const container =
      replacements.get(element.containerId) ?? byId.get(element.containerId);
    if (
      !container ||
      !isFiniteNumber(container.x) ||
      !isFiniteNumber(container.y) ||
      !isFiniteNumber(container.width) ||
      !isFiniteNumber(container.height) ||
      !isFiniteNumber(element.width) ||
      !isFiniteNumber(element.height)
    ) {
      continue;
    }

    const position =
      container.type === "arrow"
        ? positionNativeArrowLabel(container, element, byId)
        : {
            x: container.x + (container.width - element.width) / 2,
            y: container.y + (container.height - element.height) / 2,
          };
    const { x, y } = position;
    if (
      element.x !== x ||
      element.y !== y ||
      element.textAlign !== "center" ||
      element.verticalAlign !== "middle"
    ) {
      const centeredText = {
        ...element,
        x,
        y,
        textAlign: "center",
        verticalAlign: "middle",
      };
      replacements.set(element.id, centeredText);
      byId.set(element.id, centeredText);
    }

    const boundElement = { id: element.id, type: "text" };
    if (!container.boundElements?.some((item: any) => item.id === element.id)) {
      if (sceneIds.has(container.id)) {
        const boundContainer = {
          ...container,
          boundElements: [...(container.boundElements ?? []), boundElement],
        };
        replacements.set(container.id, boundContainer);
        byId.set(container.id, boundContainer);
      } else {
        addBoundElement(container, boundElement);
      }
    }
  }

  return replacements.size > 0
    ? elements.map((element) => replacements.get(element.id) ?? element)
    : elements;
}

function getBoundTextMaxWidth(container: any): number {
  const width = Math.max(container.width ?? 0, 40);
  if (container.type === "diamond") {
    return width * 0.7;
  }
  if (container.type === "ellipse") {
    return width * 0.75;
  }
  if (container.type === "arrow") {
    return Math.max(width - 16, 40);
  }
  return Math.max(width - 10, 40);
}

function expandContainerForLabel(container: any, label: any): void {
  if (container.type === "arrow" || !isFiniteNumber(container.width)) {
    return;
  }
  const fontSize = label.fontSize ?? 20;
  const lines = String(label.text).split("\n");
  const textWidth = Math.max(
    ...lines.map((line) => measureLineWidth(line, fontSize)),
    fontSize,
  );
  const paddedTextWidth = textWidth + TEXT_HORIZONTAL_SAFETY_PADDING;
  const requiredWidth =
    container.type === "diamond"
      ? paddedTextWidth / 0.7
      : container.type === "ellipse"
      ? paddedTextWidth / 0.75
      : paddedTextWidth + 10;
  if (requiredWidth <= container.width) {
    return;
  }
  const centerX = container.x + container.width / 2;
  container.width = requiredWidth;
  container.x = centerX - requiredWidth / 2;
}

function wrapText(text: string, fontSize: number, maxWidth: number): string {
  return text
    .split("\n")
    .flatMap((line) => wrapLine(line, fontSize, maxWidth))
    .join("\n");
}

function wrapLine(line: string, fontSize: number, maxWidth: number): string[] {
  if (measureLineWidth(line, fontSize) <= maxWidth) {
    return [line];
  }

  const segments = getWordSegments(line);
  const lines: string[] = [];
  let current = "";

  for (const segment of segments) {
    if (measureLineWidth(current + segment, fontSize) <= maxWidth) {
      current += segment;
      continue;
    }
    if (current.trim()) {
      lines.push(current.trimEnd());
    }
    current = "";

    for (const glyph of Array.from(segment)) {
      if (measureLineWidth(current + glyph, fontSize) > maxWidth && current) {
        lines.push(current.trimEnd());
        current = "";
      }
      current += glyph;
    }
  }

  if (current.trim() || lines.length === 0) {
    lines.push(current.trimEnd());
  }
  return lines;
}

function getWordSegments(text: string): string[] {
  if (typeof Intl.Segmenter !== "function") {
    return Array.from(text);
  }
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

function measureLineWidth(text: string, fontSize: number): number {
  if (hasMapleFontMetrics()) {
    return measureMapleTextWidth(text, fontSize);
  }
  if (process.env.MCP_TEXT_METRICS === "legacy") {
    return Math.max(Array.from(text).length, 1) * fontSize * 0.5;
  }

  return Array.from(text).reduce(
    (width, glyph) => width + getGlyphWidth(glyph) * fontSize,
    0,
  );
}

function getGlyphWidth(glyph: string): number {
  if (/\s/u.test(glyph)) {
    return 0.35;
  }
  if (
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
      glyph,
    )
  ) {
    return 1;
  }
  if (/\p{Number}/u.test(glyph)) {
    return 0.56;
  }
  if (/\p{Letter}/u.test(glyph)) {
    return 0.56;
  }
  if (/\p{Emoji_Presentation}/u.test(glyph)) {
    return 1.2;
  }
  return 0.42;
}

function bindArrowEndpoint(
  arrow: any,
  binding: any,
  endpoint: "start" | "end",
  byId: Map<string, any>,
): void {
  const elementId = binding?.elementId ?? binding?.id;
  if (!elementId) {
    return;
  }
  const target = byId.get(elementId);
  if (!target) {
    return;
  }
  const fixedPoint = normalizeFixedPoint(
    binding.fixedPoint ?? defaultFixedPoint(endpoint),
  );
  arrow[`${endpoint}Binding`] = {
    elementId,
    mode: "orbit",
    fixedPoint,
  };
  addBoundElement(target, { id: arrow.id, type: "arrow" });
}

function addBoundElement(element: any, boundElement: any): void {
  const existing = element.boundElements ?? [];
  if (!existing.some((item: any) => item.id === boundElement.id)) {
    element.boundElements = [...existing, boundElement];
  }
}

function defaultFixedPoint(endpoint: "start" | "end"): [number, number] {
  return endpoint === "start" ? [1, 0.5] : [0, 0.5];
}

function normalizeFixedPoint(fixedPoint: [number, number]): [number, number] {
  return fixedPoint.map((ratio) =>
    Math.abs(ratio - 0.5) < 0.0001 ? 0.5001 : ratio,
  ) as [number, number];
}

function normalizeBoundArrowGeometry(arrow: any): void {
  if (!arrow.startBinding && !arrow.endBinding) {
    return;
  }
  if (!Array.isArray(arrow.points) || arrow.points.length < 2) {
    return;
  }

  const points = arrow.points.map((point: [number, number]) => [...point]);
  const lastIndex = points.length - 1;
  const previous = points[lastIndex - 1];
  const last = points[lastIndex];

  if (last[0] > previous[0]) {
    points[0][0] = 0.5;
    points[lastIndex][0] -= 0.5;
  } else if (last[0] < previous[0]) {
    points[0][0] = -0.5;
    points[lastIndex][0] += 0.5;
  }
  if (last[1] > previous[1]) {
    points[0][1] = 0.5;
    points[lastIndex][1] -= 0.5;
  } else if (last[1] < previous[1]) {
    points[0][1] = -0.5;
    points[lastIndex][1] += 0.5;
  }

  const [offsetX, offsetY] = points[0];
  arrow.x += offsetX;
  arrow.y += offsetY;
  arrow.points = points.map(([x, y]: [number, number]) => [
    x - offsetX,
    y - offsetY,
  ]);
}

function stableNumber(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
