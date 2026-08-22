export type SceneQueryErrorCode =
  | "INVALID_SELECTOR"
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_AMBIGUOUS"
  | "BOUND_TEXT_BROKEN"
  | "BOUND_TEXT_AMBIGUOUS";

export class SceneQueryError extends Error {
  readonly code: SceneQueryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: SceneQueryErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SceneQueryError";
    this.code = code;
    this.details = details;
  }
}

export type TextMatchMode = "exact" | "contains";

export type SceneElementSelector = Readonly<{
  id?: string;
  elementId?: string;
  ids?: readonly string[];
  elementIds?: readonly string[];
  text?: string;
  textMatch?: TextMatchMode;
  match?: TextMatchMode;
  caseSensitive?: boolean;
  type?: string | readonly string[];
  types?: readonly string[];
  includeDeleted?: boolean;
  includeBoundTextElements?: boolean;
  limit?: number;
}>;

export type ElementVersion = Readonly<{
  version: number | null;
  versionNonce: number | null;
}>;

export type BoundTextProjection = ElementVersion &
  Readonly<{
    id: string;
    containerId: string;
    text: string;
    originalText: string;
  }>;

export type BoundTextIssueCode =
  | "DUPLICATE_CONTAINER_ID"
  | "DUPLICATE_TEXT_REFERENCE"
  | "TEXT_ELEMENT_MISSING"
  | "TEXT_ELEMENT_DELETED"
  | "REFERENCED_ELEMENT_NOT_TEXT"
  | "CONTAINER_REFERENCE_MISSING"
  | "CONTAINER_BACK_REFERENCE_MISSING"
  | "CONTAINER_ID_MISMATCH"
  | "MULTIPLE_BOUND_TEXTS";

export type BoundTextIssue = Readonly<{
  code: BoundTextIssueCode;
  elementId: string;
  message: string;
}>;

export type BoundTextResolution = Readonly<{
  status: "none" | "bound" | "broken" | "ambiguous";
  containerId: string;
  textElementId: string | null;
  textElement: Readonly<Record<string, any>> | null;
  boundText: BoundTextProjection | null;
  issues: readonly BoundTextIssue[];
}>;

export type EndpointStatus = "bound" | "free" | "broken";

export type SceneGraphEndpoint = Readonly<{
  end: "start" | "end";
  status: EndpointStatus;
  elementId: string | null;
  nodeId: string | null;
  elementType: string | null;
  binding: Readonly<Record<string, any>> | null;
}>;

export type ArrowheadMode = "end-only" | "start-only" | "both" | "none";
export type SceneGraphDirection =
  | "forward"
  | "reverse"
  | "bidirectional"
  | "undirected";

export type DirectedSceneGraphRelation = Readonly<{
  from: SceneGraphEndpoint;
  to: SceneGraphEndpoint;
}>;

export type SceneElementProjection = ElementVersion &
  Readonly<{
    id: string;
    type: string;
    isDeleted: boolean;
    text: string | null;
    containerId: string | null;
    boundText: BoundTextProjection | null;
    boundTextResolution: BoundTextResolution | null;
    startBinding: Readonly<Record<string, any>> | null;
    endBinding: Readonly<Record<string, any>> | null;
    startArrowhead: unknown | null;
    endArrowhead: unknown | null;
  }>;

export type SceneElementQueryResult = Readonly<{
  elements: readonly SceneElementProjection[];
  matches: readonly SceneElementProjection[];
  total: number;
}>;

export type SceneGraphNode = ElementVersion &
  Readonly<{
    id: string;
    type: string;
    text: string | null;
    boundText: BoundTextProjection | null;
    boundTextResolution: BoundTextResolution | null;
  }>;

export type SceneGraphEdge = ElementVersion &
  Readonly<{
    id: string;
    type: "arrow";
    text: string | null;
    boundText: BoundTextProjection | null;
    boundTextResolution: BoundTextResolution;
    arrowheadMode: ArrowheadMode;
    direction: SceneGraphDirection;
    start: SceneGraphEndpoint;
    end: SceneGraphEndpoint;
    source: SceneGraphEndpoint;
    target: SceneGraphEndpoint;
    sourceId: string | null;
    targetId: string | null;
    directedRelations: readonly DirectedSceneGraphRelation[];
  }>;

export type SceneGraph = Readonly<{
  nodes: readonly SceneGraphNode[];
  edges: readonly SceneGraphEdge[];
}>;

type ElementIndex = Readonly<{
  allById: ReadonlyMap<string, readonly Readonly<Record<string, any>>[]>;
  liveById: ReadonlyMap<string, readonly Readonly<Record<string, any>>[]>;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, any>> =>
  typeof value === "object" && value !== null;

const isSceneElement = (
  value: unknown,
): value is Readonly<Record<string, any>> & { id: string; type: string } =>
  isRecord(value) &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.type === "string" &&
  value.type.length > 0;

const isLiveElement = (element: Readonly<Record<string, any>>) =>
  element.isDeleted !== true;

const isTextElement = (element: Readonly<Record<string, any>>) =>
  element.type === "text";

const isBoundTextElement = (element: Readonly<Record<string, any>>) =>
  isTextElement(element) &&
  typeof element.containerId === "string" &&
  element.containerId.length > 0;

const isTextContainer = (element: Readonly<Record<string, any>>) =>
  element.type === "rectangle" ||
  element.type === "diamond" ||
  element.type === "ellipse" ||
  element.type === "arrow";

const readVersion = (element: Readonly<Record<string, any>>): ElementVersion => ({
  version: typeof element.version === "number" ? element.version : null,
  versionNonce:
    typeof element.versionNonce === "number" ? element.versionNonce : null,
});

const readText = (element: Readonly<Record<string, any>>) => {
  if (!isTextElement(element)) {
    return null;
  }
  if (typeof element.originalText === "string") {
    return element.originalText;
  }
  return typeof element.text === "string" ? element.text : null;
};

const createElementIndex = (elements: readonly any[]): ElementIndex => {
  const allById = new Map<
    string,
    readonly Readonly<Record<string, any>>[]
  >();
  const liveById = new Map<
    string,
    readonly Readonly<Record<string, any>>[]
  >();

  for (const candidate of elements) {
    if (!isSceneElement(candidate)) {
      continue;
    }
    allById.set(candidate.id, [...(allById.get(candidate.id) ?? []), candidate]);
    if (isLiveElement(candidate)) {
      liveById.set(candidate.id, [
        ...(liveById.get(candidate.id) ?? []),
        candidate,
      ]);
    }
  }

  return { allById, liveById };
};

const getUniqueIndexedElement = (
  index: ElementIndex,
  elementId: string,
  includeDeleted: boolean,
) => {
  const candidates = (includeDeleted ? index.allById : index.liveById).get(
    elementId,
  ) ?? [];
  if (candidates.length === 0) {
    throw new SceneQueryError(
      "ELEMENT_NOT_FOUND",
      `Scene element "${elementId}" was not found.`,
      { elementId },
    );
  }
  if (candidates.length > 1) {
    throw new SceneQueryError(
      "ELEMENT_AMBIGUOUS",
      `Scene element id "${elementId}" is not unique.`,
      { elementId, count: candidates.length },
    );
  }
  return candidates[0];
};

const resolveContainerId = (
  containerOrId: string | Readonly<Record<string, any>>,
) => {
  if (typeof containerOrId === "string") {
    return containerOrId;
  }
  if (
    isTextElement(containerOrId) &&
    typeof containerOrId.containerId === "string" &&
    containerOrId.containerId.length > 0
  ) {
    return containerOrId.containerId;
  }
  if (typeof containerOrId.id === "string" && containerOrId.id.length > 0) {
    return containerOrId.id;
  }
  throw new SceneQueryError(
    "INVALID_SELECTOR",
    "A container id or element with an id is required.",
  );
};

const toBoundTextProjection = (
  element: Readonly<Record<string, any>>,
  containerId: string,
): BoundTextProjection => ({
  id: element.id,
  containerId,
  text: readText(element) ?? "",
  originalText:
    typeof element.originalText === "string"
      ? element.originalText
      : typeof element.text === "string"
        ? element.text
        : "",
  ...readVersion(element),
});

const inspectBoundTextWithIndex = (
  index: ElementIndex,
  containerOrId: string | Readonly<Record<string, any>>,
): BoundTextResolution => {
  const containerId = resolveContainerId(containerOrId);
  const containers = index.liveById.get(containerId) ?? [];
  const issues: BoundTextIssue[] = [];

  if (containers.length > 1) {
    issues.push({
      code: "DUPLICATE_CONTAINER_ID",
      elementId: containerId,
      message: `Multiple live elements use container id "${containerId}".`,
    });
  }

  const container = containers[0] ?? null;
  const forwardTextIds = Array.isArray(container?.boundElements)
    ? container.boundElements
        .filter(
          (binding: unknown) =>
            isRecord(binding) &&
            binding.type === "text" &&
            typeof binding.id === "string",
        )
        .map((binding: Readonly<Record<string, any>>) => binding.id as string)
    : [];
  const uniqueForwardIds = [...new Set(forwardTextIds)];

  if (uniqueForwardIds.length !== forwardTextIds.length) {
    issues.push({
      code: "DUPLICATE_TEXT_REFERENCE",
      elementId: containerId,
      message: `Container "${containerId}" repeats a bound text reference.`,
    });
  }

  const backReferencedTexts: Readonly<Record<string, any>>[] = [];
  for (const candidates of index.liveById.values()) {
    for (const candidate of candidates) {
      if (isTextElement(candidate) && candidate.containerId === containerId) {
        backReferencedTexts.push(candidate);
      }
    }
  }

  const candidateIds = new Set<string>([
    ...uniqueForwardIds,
    ...backReferencedTexts.map((element) => element.id as string),
  ]);

  for (const textId of uniqueForwardIds) {
    const allCandidates = index.allById.get(textId) ?? [];
    const liveCandidates = index.liveById.get(textId) ?? [];
    if (allCandidates.length === 0) {
      issues.push({
        code: "TEXT_ELEMENT_MISSING",
        elementId: textId,
        message: `Bound text "${textId}" does not exist.`,
      });
      continue;
    }
    if (liveCandidates.length === 0) {
      issues.push({
        code: "TEXT_ELEMENT_DELETED",
        elementId: textId,
        message: `Bound text "${textId}" is deleted.`,
      });
      continue;
    }
    if (!liveCandidates.some(isTextElement)) {
      issues.push({
        code: "REFERENCED_ELEMENT_NOT_TEXT",
        elementId: textId,
        message: `Element "${textId}" is referenced as text but has another type.`,
      });
    }
  }

  for (const textElement of backReferencedTexts) {
    if (!uniqueForwardIds.includes(textElement.id)) {
      issues.push({
        code: "CONTAINER_BACK_REFERENCE_MISSING",
        elementId: textElement.id,
        message: `Text "${textElement.id}" points to container "${containerId}", but the container does not point back.`,
      });
    }
  }

  for (const textId of uniqueForwardIds) {
    const textElement = (index.liveById.get(textId) ?? []).find(isTextElement);
    if (!textElement) {
      continue;
    }
    if (typeof textElement.containerId !== "string") {
      issues.push({
        code: "CONTAINER_REFERENCE_MISSING",
        elementId: textId,
        message: `Text "${textId}" does not point back to its container.`,
      });
    } else if (textElement.containerId !== containerId) {
      issues.push({
        code: "CONTAINER_ID_MISMATCH",
        elementId: textId,
        message: `Text "${textId}" points to container "${textElement.containerId}" instead of "${containerId}".`,
      });
    }
  }

  if (candidateIds.size > 1) {
    issues.push({
      code: "MULTIPLE_BOUND_TEXTS",
      elementId: containerId,
      message: `Container "${containerId}" resolves to multiple bound texts.`,
    });
  }

  const textElementId = candidateIds.size === 1 ? [...candidateIds][0] : null;
  const textElement = textElementId
    ? ((index.liveById.get(textElementId) ?? []).find(isTextElement) ?? null)
    : null;
  const ambiguous =
    candidateIds.size > 1 ||
    containers.length > 1 ||
    (textElementId !== null &&
      (index.liveById.get(textElementId) ?? []).filter(isTextElement).length > 1);
  const status = ambiguous
    ? "ambiguous"
    : issues.length > 0
      ? "broken"
      : textElement
        ? "bound"
        : "none";

  return {
    status,
    containerId,
    textElementId,
    textElement,
    boundText:
      status === "bound" && textElement
        ? toBoundTextProjection(textElement, containerId)
        : null,
    issues,
  };
};

export const inspectBoundText = (
  elements: readonly any[],
  containerOrId: string | Readonly<Record<string, any>>,
) => inspectBoundTextWithIndex(createElementIndex(elements), containerOrId);

export const resolveBoundText = inspectBoundText;

export const resolveBoundTextElement = (
  elements: readonly any[],
  containerOrId: string | Readonly<Record<string, any>>,
) => {
  const resolution = inspectBoundText(elements, containerOrId);
  if (resolution.status === "ambiguous") {
    throw new SceneQueryError(
      "BOUND_TEXT_AMBIGUOUS",
      `Bound text for "${resolution.containerId}" is ambiguous.`,
      { containerId: resolution.containerId, issues: resolution.issues },
    );
  }
  if (resolution.status === "broken") {
    throw new SceneQueryError(
      "BOUND_TEXT_BROKEN",
      `Bound text for "${resolution.containerId}" is broken.`,
      { containerId: resolution.containerId, issues: resolution.issues },
    );
  }
  return resolution.textElement;
};

export const getBoundTextElement = resolveBoundTextElement;

const getElementText = (
  index: ElementIndex,
  element: Readonly<Record<string, any>>,
) => {
  const ownText = readText(element);
  if (ownText !== null) {
    return ownText;
  }
  if (!isTextContainer(element)) {
    return null;
  }
  return inspectBoundTextWithIndex(index, element).boundText?.text ?? null;
};

const getBoundTextResolution = (
  index: ElementIndex,
  element: Readonly<Record<string, any>>,
) => {
  if (!isTextContainer(element)) {
    return null;
  }
  return inspectBoundTextWithIndex(index, element);
};

const readBinding = (value: unknown) =>
  isRecord(value) ? value : null;

const toElementProjection = (
  index: ElementIndex,
  element: Readonly<Record<string, any>>,
): SceneElementProjection => {
  const boundTextResolution = getBoundTextResolution(index, element);
  return {
    id: element.id,
    type: element.type,
    isDeleted: element.isDeleted === true,
    text: getElementText(index, element),
    containerId:
      typeof element.containerId === "string" ? element.containerId : null,
    boundText: boundTextResolution?.boundText ?? null,
    boundTextResolution,
    startBinding: readBinding(element.startBinding),
    endBinding: readBinding(element.endBinding),
    startArrowhead: element.startArrowhead ?? null,
    endArrowhead: element.endArrowhead ?? null,
    ...readVersion(element),
  };
};

const normalizeSelector = (selector: SceneElementSelector) => {
  const singleId = selector.elementId ?? selector.id;
  const requestedIds = [
    ...(singleId ? [singleId] : []),
    ...(selector.elementIds ?? selector.ids ?? []),
  ];
  const ids = requestedIds.length > 0 ? new Set(requestedIds) : null;
  const requestedTypes = Array.isArray(selector.types)
    ? selector.types
    : Array.isArray(selector.type)
      ? selector.type
      : typeof selector.type === "string"
        ? [selector.type]
        : [];
  const types = requestedTypes.length > 0 ? new Set(requestedTypes) : null;
  const limit =
    typeof selector.limit === "number" && Number.isFinite(selector.limit)
      ? Math.max(0, Math.floor(selector.limit))
      : Number.POSITIVE_INFINITY;

  return {
    ids,
    types,
    text: selector.text,
    textMatch: selector.textMatch ?? selector.match ?? "exact",
    caseSensitive: selector.caseSensitive === true,
    includeDeleted: selector.includeDeleted === true,
    includeBoundTextElements: selector.includeBoundTextElements === true,
    limit,
  };
};

const textMatches = (
  candidate: string,
  query: string,
  mode: TextMatchMode,
  caseSensitive: boolean,
) => {
  const normalizedCandidate = caseSensitive
    ? candidate
    : candidate.toLocaleLowerCase();
  const normalizedQuery = caseSensitive ? query : query.toLocaleLowerCase();
  return mode === "contains"
    ? normalizedCandidate.includes(normalizedQuery)
    : normalizedCandidate === normalizedQuery;
};

export const querySceneElements = (
  elements: readonly any[],
  selector: SceneElementSelector = {},
): SceneElementQueryResult => {
  const index = createElementIndex(elements);
  const normalized = normalizeSelector(selector);
  const matches: SceneElementProjection[] = [];
  let total = 0;

  for (const candidate of elements) {
    if (!isSceneElement(candidate)) {
      continue;
    }
    if (!normalized.includeDeleted && !isLiveElement(candidate)) {
      continue;
    }
    if (
      !normalized.includeBoundTextElements &&
      isBoundTextElement(candidate)
    ) {
      continue;
    }
    if (normalized.ids && !normalized.ids.has(candidate.id)) {
      continue;
    }
    if (normalized.types && !normalized.types.has(candidate.type)) {
      continue;
    }
    if (normalized.text !== undefined) {
      const candidateText = getElementText(index, candidate);
      if (
        candidateText === null ||
        !textMatches(
          candidateText,
          normalized.text,
          normalized.textMatch,
          normalized.caseSensitive,
        )
      ) {
        continue;
      }
    }
    total += 1;
    if (matches.length < normalized.limit) {
      matches.push(toElementProjection(index, candidate));
    }
  }

  return { elements: matches, matches, total };
};

export const selectSceneElements = querySceneElements;

export const getSceneElementById = (
  elements: readonly any[],
  elementId: string,
  options: Readonly<{ includeDeleted?: boolean }> = {},
) => {
  if (!elementId) {
    throw new SceneQueryError(
      "INVALID_SELECTOR",
      "A non-empty element id is required.",
    );
  }
  return getUniqueIndexedElement(
    createElementIndex(elements),
    elementId,
    options.includeDeleted === true,
  );
};

export const findSceneElementById = getSceneElementById;

export const resolveSceneElement = (
  elements: readonly any[],
  selector: SceneElementSelector,
) => {
  const normalized = normalizeSelector(selector);
  if (
    !normalized.ids &&
    normalized.text === undefined &&
    !normalized.types
  ) {
    throw new SceneQueryError(
      "INVALID_SELECTOR",
      "An element id, text filter, or type filter is required.",
    );
  }

  const result = querySceneElements(elements, {
    ...selector,
    limit: Number.POSITIVE_INFINITY,
  });
  if (result.total === 0) {
    throw new SceneQueryError(
      "ELEMENT_NOT_FOUND",
      "No scene element matched the selector.",
      { selector },
    );
  }
  if (result.total > 1) {
    throw new SceneQueryError(
      "ELEMENT_AMBIGUOUS",
      `The selector matched ${result.total} scene elements.`,
      { selector, elementIds: result.elements.map((element) => element.id) },
    );
  }
  return getSceneElementById(elements, result.elements[0].id, {
    includeDeleted: selector.includeDeleted,
  });
};

export const resolveSceneElementByText = (
  elements: readonly any[],
  text: string,
  options: Omit<SceneElementSelector, "text" | "id" | "elementId"> = {},
) => resolveSceneElement(elements, { ...options, text });

const getEndpoint = (
  index: ElementIndex,
  nodeIds: ReadonlySet<string>,
  end: "start" | "end",
  bindingValue: unknown,
): SceneGraphEndpoint => {
  if (bindingValue === null || bindingValue === undefined) {
    return {
      end,
      status: "free",
      elementId: null,
      nodeId: null,
      elementType: null,
      binding: null,
    };
  }
  if (
    !isRecord(bindingValue) ||
    typeof bindingValue.elementId !== "string" ||
    bindingValue.elementId.length === 0
  ) {
    return {
      end,
      status: "broken",
      elementId: null,
      nodeId: null,
      elementType: null,
      binding: isRecord(bindingValue) ? bindingValue : null,
    };
  }

  const elementId = bindingValue.elementId;
  const candidates = index.liveById.get(elementId) ?? [];
  const target = candidates.length === 1 ? candidates[0] : null;
  return {
    end,
    status: target ? "bound" : "broken",
    elementId,
    nodeId: target && nodeIds.has(elementId) ? elementId : null,
    elementType: target ? target.type : null,
    binding: bindingValue,
  };
};

export const getArrowheadMode = (
  arrow: Readonly<Record<string, any>>,
): ArrowheadMode => {
  const hasStartArrowhead = arrow.startArrowhead !== null &&
    arrow.startArrowhead !== undefined;
  const hasEndArrowhead = arrow.endArrowhead !== null &&
    arrow.endArrowhead !== undefined;
  if (hasStartArrowhead && hasEndArrowhead) {
    return "both";
  }
  if (hasStartArrowhead) {
    return "start-only";
  }
  if (hasEndArrowhead) {
    return "end-only";
  }
  return "none";
};

export const getArrowDirection = (
  arrow: Readonly<Record<string, any>>,
): SceneGraphDirection => {
  switch (getArrowheadMode(arrow)) {
    case "end-only":
      return "forward";
    case "start-only":
      return "reverse";
    case "both":
      return "bidirectional";
    case "none":
      return "undirected";
  }
};

export const projectSceneGraph = (elements: readonly any[]): SceneGraph => {
  const index = createElementIndex(elements);
  const nodeElements = elements.filter(
    (candidate): candidate is Readonly<Record<string, any>> & {
      id: string;
      type: string;
    } =>
      isSceneElement(candidate) &&
      isLiveElement(candidate) &&
      candidate.type !== "selection" &&
      candidate.type !== "arrow" &&
      !isBoundTextElement(candidate),
  );
  const nodeIds = new Set(nodeElements.map((element) => element.id));
  const nodes: SceneGraphNode[] = nodeElements.map((element) => {
    const boundTextResolution = getBoundTextResolution(index, element);
    return {
      id: element.id,
      type: element.type,
      text: getElementText(index, element),
      boundText: boundTextResolution?.boundText ?? null,
      boundTextResolution,
      ...readVersion(element),
    };
  });
  const edges: SceneGraphEdge[] = [];

  for (const candidate of elements) {
    if (
      !isSceneElement(candidate) ||
      !isLiveElement(candidate) ||
      candidate.type !== "arrow"
    ) {
      continue;
    }
    const start = getEndpoint(index, nodeIds, "start", candidate.startBinding);
    const end = getEndpoint(index, nodeIds, "end", candidate.endBinding);
    const arrowheadMode = getArrowheadMode(candidate);
    const direction = getArrowDirection(candidate);
    const boundTextResolution = inspectBoundTextWithIndex(index, candidate);
    const directedRelations: DirectedSceneGraphRelation[] =
      direction === "forward"
        ? [{ from: start, to: end }]
        : direction === "reverse"
          ? [{ from: end, to: start }]
          : direction === "bidirectional"
            ? [
                { from: start, to: end },
                { from: end, to: start },
              ]
            : [];
    const source = direction === "reverse" ? end : start;
    const target = direction === "reverse" ? start : end;

    edges.push({
      id: candidate.id,
      type: "arrow",
      text: boundTextResolution.boundText?.text ?? null,
      boundText: boundTextResolution.boundText,
      boundTextResolution,
      arrowheadMode,
      direction,
      start,
      end,
      source,
      target,
      sourceId: source.nodeId,
      targetId: target.nodeId,
      directedRelations,
      ...readVersion(candidate),
    });
  }

  return { nodes, edges };
};

export const querySceneGraph = projectSceneGraph;
