import {
  computeNativeBoundTextPosition,
  refreshNativeBoundArrows,
} from "./native-derived-geometry.js";
import { deriveBoundTextDimensions } from "./server-element-conversion.js";

export const ATOMIC_SCENE_EDIT_ERROR_CODES = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_SCENE: "INVALID_SCENE",
  DUPLICATE_ELEMENT_ID: "DUPLICATE_ELEMENT_ID",
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  ELEMENT_DELETED: "ELEMENT_DELETED",
  INVALID_ELEMENT_TYPE: "INVALID_ELEMENT_TYPE",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  EDGE_ALREADY_EXISTS: "EDGE_ALREADY_EXISTS",
  SELF_LOOP_UNSUPPORTED: "SELF_LOOP_UNSUPPORTED",
  BOUND_TEXT_NOT_FOUND: "BOUND_TEXT_NOT_FOUND",
  AMBIGUOUS_BOUND_TEXT: "AMBIGUOUS_BOUND_TEXT",
  INVALID_BINDING: "INVALID_BINDING",
  DUPLICATE_OPERATION_TARGET: "DUPLICATE_OPERATION_TARGET",
  INVARIANT_VIOLATION: "INVARIANT_VIOLATION",
} as const;

export type AtomicSceneEditErrorCode =
  typeof ATOMIC_SCENE_EDIT_ERROR_CODES[keyof typeof ATOMIC_SCENE_EDIT_ERROR_CODES];

export type AtomicSceneElement = Record<string, any> & {
  id?: string;
  type: string;
};

export type ElementVersionExpectation = {
  version?: number;
  versionNonce?: number;
};

export type AtomicSceneEndpoint = ElementVersionExpectation & {
  id: string;
  fixedPoint?: [number, number];
  mode?: "inside" | "orbit" | "skip";
};

export type AddEdgeOperation = Record<string, unknown> & {
  type: "add_edge";
  edgeId?: string;
  edge?: Record<string, unknown>;
  start: AtomicSceneEndpoint;
  end: AtomicSceneEndpoint;
  label?: string;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
};

export type SetEdgeLabelOperation = Record<string, unknown> & {
  type: "set_edge_label";
  edge: ElementVersionExpectation & { id: string };
  text: string;
};

export type SetNodeLabelOperation = Record<string, unknown> & {
  type: "set_node_label";
  node: ElementVersionExpectation & { id: string };
  text: string;
};

export type AtomicSceneEditOperation =
  | AddEdgeOperation
  | SetEdgeLabelOperation
  | SetNodeLabelOperation
  | (Record<string, unknown> & {
      type?: "add_edge" | "set_edge_label" | "set_node_label";
      op?: "add_edge" | "set_edge_label" | "set_node_label";
    });

export type AtomicSceneFieldDiff = {
  operationIndex: number;
  elementId: string;
  field: string;
  before: unknown;
  after: unknown;
};

export type AtomicSceneEditResult = {
  elements: AtomicSceneElement[];
  affectedElementIds: string[];
  diff: {
    direct: AtomicSceneFieldDiff[];
    derived: AtomicSceneFieldDiff[];
  };
};

export type AtomicSceneEditInput = {
  elements: readonly AtomicSceneElement[];
  operations: readonly AtomicSceneEditOperation[];
};

export class AtomicSceneEditError extends Error {
  readonly code: AtomicSceneEditErrorCode;
  readonly operationIndex: number | null;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AtomicSceneEditErrorCode,
    message: string,
    options: {
      operationIndex?: number;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "AtomicSceneEditError";
    this.code = code;
    this.operationIndex = options.operationIndex ?? null;
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }
}

type NormalizedEndpoint = {
  elementId: string;
  expectation: ElementVersionExpectation;
  fixedPoint: [number, number] | null;
  mode: "inside" | "orbit" | "skip";
};

type NormalizedAddEdge = {
  kind: "add_edge";
  operationIndex: number;
  edgeId: string;
  edgeInput: Record<string, unknown>;
  start: NormalizedEndpoint;
  end: NormalizedEndpoint;
};

type NormalizedSetLabel = {
  kind: "set_edge_label" | "set_node_label";
  operationIndex: number;
  targetId: string;
  text: string;
  expectation: ElementVersionExpectation;
  textExpectation: ElementVersionExpectation;
  textId: string;
};

type NormalizedOperation = NormalizedAddEdge | NormalizedSetLabel;
type DiffKind = "direct" | "derived";
type ChangeAttribution = { kind: DiffKind; operationIndex: number };

const PSEUDO_TYPES = new Set(["cameraUpdate", "delete", "restoreCheckpoint"]);
const NODE_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "image",
  "iframe",
  "embeddable",
  "frame",
  "magicframe",
  "text",
]);
const NODE_LABEL_TYPES = new Set(["rectangle", "diamond", "ellipse"]);
const BIND_MODES = new Set(["inside", "orbit", "skip"]);

export function applyAtomicSceneEdit(
  input: AtomicSceneEditInput,
): AtomicSceneEditResult;
export function applyAtomicSceneEdit(
  elements: readonly AtomicSceneElement[],
  operations: readonly AtomicSceneEditOperation[],
): AtomicSceneEditResult;
export function applyAtomicSceneEdit(
  elementsOrInput: readonly AtomicSceneElement[] | AtomicSceneEditInput,
  maybeOperations?: readonly AtomicSceneEditOperation[],
): AtomicSceneEditResult {
  const inputObject = Array.isArray(elementsOrInput)
    ? null
    : (elementsOrInput as AtomicSceneEditInput);
  const elements = inputObject ? inputObject.elements : elementsOrInput;
  const operations = inputObject ? inputObject.operations : maybeOperations;

  if (!Array.isArray(elements) || !Array.isArray(operations)) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
      "Atomic scene edit requires elements and operations arrays.",
    );
  }

  const workingElements = deepClone(elements) as AtomicSceneElement[];
  const sourceById = indexElements(workingElements);
  const normalizedOperations = prevalidateOperations(operations, sourceById);
  const workingById = new Map(sourceById);
  const attributions = new Map<string, Map<string, ChangeAttribution>>();
  const changedExistingIds = new Set<string>();
  const newElementIds = new Set<string>();
  const geometryTriggers = new Map<string, ChangeAttribution>();

  const setField = (
    element: AtomicSceneElement,
    field: string,
    value: unknown,
    attribution: ChangeAttribution,
  ) => {
    if (isDeepEqual(element[field], value)) {
      return;
    }
    element[field] = deepClone(value);
    markAttribution(attributions, element.id as string, field, attribution);
    if (!newElementIds.has(element.id as string)) {
      changedExistingIds.add(element.id as string);
    }
  };

  for (const operation of normalizedOperations) {
    if (operation.kind === "add_edge") {
      const startNode = workingById.get(
        operation.start.elementId,
      ) as AtomicSceneElement;
      const endNode = workingById.get(
        operation.end.elementId,
      ) as AtomicSceneElement;
      const edge = createArrowElement(
        operation,
        startNode,
        endNode,
        workingElements.length,
      );
      workingElements.push(edge);
      workingById.set(operation.edgeId, edge);
      newElementIds.add(operation.edgeId);
      markAttribution(attributions, operation.edgeId, "", {
        kind: "direct",
        operationIndex: operation.operationIndex,
      });
      addBoundElement(
        startNode,
        { id: operation.edgeId, type: "arrow" },
        operation.operationIndex,
        setField,
      );
      addBoundElement(
        endNode,
        { id: operation.edgeId, type: "arrow" },
        operation.operationIndex,
        setField,
      );
      continue;
    }

    const container = workingById.get(operation.targetId) as AtomicSceneElement;
    const textElement = workingById.get(operation.textId) as AtomicSceneElement;
    addBoundElement(
      container,
      { id: textElement.id as string, type: "text" },
      operation.operationIndex,
      setField,
    );
    setField(textElement, "containerId", container.id, {
      kind: "derived",
      operationIndex: operation.operationIndex,
    });
    setField(textElement, "text", operation.text, {
      kind: "direct",
      operationIndex: operation.operationIndex,
    });
    setField(textElement, "originalText", operation.text, {
      kind: "direct",
      operationIndex: operation.operationIndex,
    });
    geometryTriggers.set(operation.targetId, {
      kind: "derived",
      operationIndex: operation.operationIndex,
    });
    geometryTriggers.set(operation.textId, {
      kind: "derived",
      operationIndex: operation.operationIndex,
    });
  }

  redrawDerivedGeometry(
    workingElements,
    workingById,
    geometryTriggers,
    attributions,
    setField,
  );

  for (const elementId of changedExistingIds) {
    const element = workingById.get(elementId) as AtomicSceneElement;
    const attribution = firstAttributionForElement(attributions, elementId);
    const nextVersion = element.version + 1;
    const nextNonce = nextVersionNonce(element, attributions.get(elementId));
    setMetadataField(
      element,
      "version",
      nextVersion,
      attribution,
      attributions,
    );
    setMetadataField(
      element,
      "versionNonce",
      nextNonce,
      attribution,
      attributions,
    );
    setMetadataField(
      element,
      "updated",
      nextUpdatedValue(element.updated),
      attribution,
      attributions,
    );
  }

  validateAffectedBindings(workingById, attributions);

  const sourceElementsById = indexElements(
    deepClone(elements) as AtomicSceneElement[],
  );
  const diff = buildFieldDiffs(
    workingElements,
    sourceElementsById,
    attributions,
  );
  const affectedElementIds = workingElements
    .map((element) => element.id)
    .filter(
      (elementId): elementId is string =>
        typeof elementId === "string" && attributions.has(elementId),
    );

  return {
    elements: workingElements,
    affectedElementIds,
    diff,
  };
}

export const applyAtomicSceneEdits = applyAtomicSceneEdit;
export const applySceneOperations = applyAtomicSceneEdit;

function redrawDerivedGeometry(
  workingElements: readonly AtomicSceneElement[],
  workingById: Map<string, AtomicSceneElement>,
  geometryTriggers: Map<string, ChangeAttribution>,
  attributions: Map<string, Map<string, ChangeAttribution>>,
  setField: (
    element: AtomicSceneElement,
    field: string,
    value: unknown,
    attribution: ChangeAttribution,
  ) => void,
): void {
  if (geometryTriggers.size === 0) {
    return;
  }

  const redrawById = new Map<string, AtomicSceneElement>();
  for (const element of workingElements) {
    if (typeof element.id === "string" && !PSEUDO_TYPES.has(element.type)) {
      redrawById.set(element.id, deepClone(element));
    }
  }
  for (const [elementId] of geometryTriggers) {
    const element = redrawById.get(elementId);
    if (!element) {
      continue;
    }
    if (element.type === "text" && typeof element.containerId === "string") {
      const container = redrawById.get(element.containerId);
      if (container) {
        const dimensions = deriveBoundTextDimensions(element, container);
        Object.assign(element, dimensions);
        Object.assign(
          element,
          computeNativeBoundTextPosition(container, element, redrawById),
        );
      }
    }
  }
  refreshNativeBoundArrows(redrawById, geometryTriggers.keys());

  for (const redrawn of redrawById.values()) {
    const working = workingById.get(redrawn.id as string);
    if (!working) {
      continue;
    }
    const attribution = resolveGeometryAttribution(
      redrawn,
      geometryTriggers,
      attributions,
    );
    if (!attribution) {
      continue;
    }
    for (const field of Object.keys(redrawn)) {
      if (
        field === "version" ||
        field === "versionNonce" ||
        field === "updated"
      ) {
        continue;
      }
      setField(working, field, redrawn[field], {
        kind: "derived",
        operationIndex: attribution.operationIndex,
      });
    }
  }
}

function resolveGeometryAttribution(
  element: AtomicSceneElement,
  geometryTriggers: Map<string, ChangeAttribution>,
  attributions: Map<string, Map<string, ChangeAttribution>>,
): ChangeAttribution | null {
  const candidates = [
    geometryTriggers.get(element.id as string),
    typeof element.containerId === "string"
      ? geometryTriggers.get(element.containerId)
      : undefined,
    typeof element.startBinding?.elementId === "string"
      ? geometryTriggers.get(element.startBinding.elementId)
      : undefined,
    typeof element.endBinding?.elementId === "string"
      ? geometryTriggers.get(element.endBinding.elementId)
      : undefined,
  ].filter((candidate): candidate is ChangeAttribution => Boolean(candidate));
  const existing = attributions.get(element.id as string);
  if (existing) {
    candidates.push(
      firstAttributionForElement(attributions, element.id as string),
    );
  }
  return (
    candidates.sort(
      (left, right) => left.operationIndex - right.operationIndex,
    )[0] ?? null
  );
}

function prevalidateOperations(
  operations: readonly AtomicSceneEditOperation[],
  elementsById: Map<string, AtomicSceneElement>,
): NormalizedOperation[] {
  const normalized: NormalizedOperation[] = [];
  const plannedEdgeIds = new Set<string>();
  const labelTargets = new Set<string>();

  for (const [operationIndex, rawOperation] of operations.entries()) {
    const operation = asObject(rawOperation, operationIndex, "operation");
    const kind = operation.type ?? operation.op;
    if (
      kind !== "add_edge" &&
      kind !== "set_edge_label" &&
      kind !== "set_node_label"
    ) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
        `Unsupported atomic scene operation at index ${operationIndex}.`,
        operationIndex,
        { kind },
      );
    }

    if (kind === "add_edge") {
      const nestedEdgeInput = optionalObject(
        operation.edge ?? operation.element ?? operation.arrow,
      );
      const edgeInput = {
        ...pickEdgeInput(operation),
        ...(nestedEdgeInput ?? {}),
      };
      const edgeId = requireString(
        edgeInput.id ?? operation.edgeId ?? operation.id,
        operationIndex,
        "edgeId",
      );
      if (elementsById.has(edgeId) || plannedEdgeIds.has(edgeId)) {
        fail(
          ATOMIC_SCENE_EDIT_ERROR_CODES.EDGE_ALREADY_EXISTS,
          `Edge "${edgeId}" already exists.`,
          operationIndex,
          { elementId: edgeId },
        );
      }
      const start = normalizeEndpoint(operation, "start", operationIndex);
      const end = normalizeEndpoint(operation, "end", operationIndex);
      if (start.elementId === end.elementId) {
        fail(
          ATOMIC_SCENE_EDIT_ERROR_CODES.SELF_LOOP_UNSUPPORTED,
          "Self-loop edges are not supported.",
          operationIndex,
          { elementId: start.elementId },
        );
      }
      const startNode = requireLiveElement(
        elementsById,
        start.elementId,
        operationIndex,
      );
      const endNode = requireLiveElement(
        elementsById,
        end.elementId,
        operationIndex,
      );
      assertElementType(startNode, NODE_TYPES, "bindable node", operationIndex);
      assertElementType(endNode, NODE_TYPES, "bindable node", operationIndex);
      assertMutableElement(startNode, operationIndex);
      assertMutableElement(endNode, operationIndex);
      assertRequiredExpectation(start.expectation, operationIndex, "start");
      assertRequiredExpectation(end.expectation, operationIndex, "end");
      assertExpectation(startNode, start.expectation, operationIndex);
      assertExpectation(endNode, end.expectation, operationIndex);
      assertBoundElements(startNode, operationIndex);
      assertBoundElements(endNode, operationIndex);
      validateNewEdgeInput(edgeInput, edgeId, operationIndex);
      plannedEdgeIds.add(edgeId);
      normalized.push({
        kind,
        operationIndex,
        edgeId,
        edgeInput: deepClone(edgeInput),
        start,
        end,
      });
      continue;
    }

    const targetObject = optionalObject(
      operation.edge ?? operation.node ?? operation.target,
    );
    const targetId = requireString(
      operation.edgeId ??
        operation.nodeId ??
        operation.elementId ??
        targetObject?.elementId ??
        targetObject?.id ??
        operation.id,
      operationIndex,
      kind === "set_edge_label" ? "edgeId" : "nodeId",
    );
    if (labelTargets.has(targetId)) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.DUPLICATE_OPERATION_TARGET,
        `More than one label operation targets "${targetId}".`,
        operationIndex,
        { elementId: targetId },
      );
    }
    const target = requireLiveElement(elementsById, targetId, operationIndex);
    assertElementType(
      target,
      kind === "set_edge_label" ? new Set(["arrow"]) : NODE_LABEL_TYPES,
      kind === "set_edge_label" ? "arrow" : "node text container",
      operationIndex,
    );
    assertMutableElement(target, operationIndex);
    const expectation = readExpectation(operation, targetObject);
    assertRequiredExpectation(
      expectation,
      operationIndex,
      kind === "set_edge_label" ? "edge" : "node",
    );
    assertExpectation(target, expectation, operationIndex);
    const text = operation.text ?? operation.label ?? operation.value;
    if (typeof text !== "string") {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
        `Operation ${operationIndex} requires a string label.`,
        operationIndex,
        { field: "text" },
      );
    }
    const textElement = resolveBoundText(target, elementsById, operationIndex);
    assertMutableElement(textElement, operationIndex);
    const textExpectation = readTextExpectation(operation);
    assertExpectation(textElement, textExpectation, operationIndex);
    labelTargets.add(targetId);
    normalized.push({
      kind,
      operationIndex,
      targetId,
      text,
      expectation,
      textExpectation,
      textId: textElement.id as string,
    });
  }

  return normalized;
}

function normalizeEndpoint(
  operation: Record<string, unknown>,
  endpoint: "start" | "end",
  operationIndex: number,
): NormalizedEndpoint {
  const aliases =
    endpoint === "start"
      ? ["start", "startBinding", "source", "from"]
      : ["end", "endBinding", "target", "to"];
  const endpointObject =
    aliases
      .map((key) => optionalObject(operation[key]))
      .find((value) => value !== null) ?? null;
  const idKeys =
    endpoint === "start"
      ? ["startNodeId", "sourceId", "fromId"]
      : ["endNodeId", "targetId", "toId"];
  const elementId = requireString(
    idKeys.map((key) => operation[key]).find((value) => value !== undefined) ??
      endpointObject?.elementId ??
      endpointObject?.id,
    operationIndex,
    `${endpoint}NodeId`,
  );
  const expectation = readEndpointExpectation(
    operation,
    endpoint,
    endpointObject,
  );
  const fixedPoint = readFixedPoint(endpointObject?.fixedPoint, operationIndex);
  const modeValue = endpointObject?.mode ?? "orbit";
  if (typeof modeValue !== "string" || !BIND_MODES.has(modeValue)) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
      `Invalid ${endpoint} binding mode.`,
      operationIndex,
      { mode: modeValue },
    );
  }
  return {
    elementId,
    expectation,
    fixedPoint,
    mode: modeValue as NormalizedEndpoint["mode"],
  };
}

function readEndpointExpectation(
  operation: Record<string, unknown>,
  endpoint: "start" | "end",
  endpointObject: Record<string, unknown> | null,
): ElementVersionExpectation {
  const capitalized = endpoint === "start" ? "Start" : "End";
  const expected = optionalObject(operation.expected);
  const nestedExpected = optionalObject(endpointObject?.expected);
  const roleExpected = optionalObject(expected?.[endpoint]);
  return compactExpectation(
    endpointObject?.expectedVersion ??
      nestedExpected?.version ??
      roleExpected?.version ??
      operation[`expected${capitalized}Version`] ??
      operation[`${endpoint}ExpectedVersion`] ??
      endpointObject?.version,
    endpointObject?.expectedVersionNonce ??
      nestedExpected?.versionNonce ??
      roleExpected?.versionNonce ??
      operation[`expected${capitalized}VersionNonce`] ??
      operation[`${endpoint}ExpectedVersionNonce`] ??
      endpointObject?.versionNonce,
  );
}

function readExpectation(
  operation: Record<string, unknown>,
  targetObject: Record<string, unknown> | null,
): ElementVersionExpectation {
  const expected = optionalObject(operation.expected);
  const targetExpected = optionalObject(targetObject?.expected);
  return compactExpectation(
    operation.expectedVersion ??
      expected?.version ??
      targetObject?.expectedVersion ??
      targetExpected?.version ??
      targetObject?.version,
    operation.expectedVersionNonce ??
      expected?.versionNonce ??
      targetObject?.expectedVersionNonce ??
      targetExpected?.versionNonce ??
      targetObject?.versionNonce,
  );
}

function readTextExpectation(
  operation: Record<string, unknown>,
): ElementVersionExpectation {
  const expectedText = optionalObject(
    operation.expectedText ?? operation.expectedLabel,
  );
  return compactExpectation(
    operation.expectedTextVersion ??
      operation.expectedLabelVersion ??
      expectedText?.version,
    operation.expectedTextVersionNonce ??
      operation.expectedLabelVersionNonce ??
      expectedText?.versionNonce,
  );
}

function compactExpectation(
  version: unknown,
  versionNonce: unknown,
): ElementVersionExpectation {
  return {
    ...(version !== undefined ? { version: version as number } : {}),
    ...(versionNonce !== undefined
      ? { versionNonce: versionNonce as number }
      : {}),
  };
}

function assertExpectation(
  element: AtomicSceneElement,
  expectation: ElementVersionExpectation,
  operationIndex: number,
): void {
  for (const field of ["version", "versionNonce"] as const) {
    const expected = expectation[field];
    if (expected === undefined) {
      continue;
    }
    if (!Number.isInteger(expected)) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
        `Expected ${field} must be an integer.`,
        operationIndex,
        { elementId: element.id, field, expected },
      );
    }
    if (element[field] !== expected) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.VERSION_CONFLICT,
        `Element "${element.id}" ${field} does not match.`,
        operationIndex,
        {
          elementId: element.id,
          field,
          expected,
          actual: element[field],
        },
      );
    }
  }
}

function assertRequiredExpectation(
  expectation: ElementVersionExpectation,
  operationIndex: number,
  field: string,
): void {
  if (
    expectation.version === undefined ||
    expectation.versionNonce === undefined
  ) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
      `Operation ${operationIndex} requires ${field} version and versionNonce.`,
      operationIndex,
      { field },
    );
  }
}

function resolveBoundText(
  container: AtomicSceneElement,
  elementsById: Map<string, AtomicSceneElement>,
  operationIndex: number,
): AtomicSceneElement {
  assertBoundElements(container, operationIndex);
  const candidateIds = new Set<string>();
  for (const boundElement of container.boundElements ?? []) {
    if (boundElement.type !== "text") {
      continue;
    }
    if (typeof boundElement.id !== "string") {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_BINDING,
        `Container "${container.id}" has an invalid bound text reference.`,
        operationIndex,
        { elementId: container.id },
      );
    }
    candidateIds.add(boundElement.id);
  }
  for (const element of elementsById.values()) {
    if (
      element.type === "text" &&
      !element.isDeleted &&
      element.containerId === container.id
    ) {
      candidateIds.add(element.id as string);
    }
  }
  if (candidateIds.size === 0) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.BOUND_TEXT_NOT_FOUND,
      `Container "${container.id}" has no bound text.`,
      operationIndex,
      { elementId: container.id },
    );
  }
  if (candidateIds.size > 1) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.AMBIGUOUS_BOUND_TEXT,
      `Container "${container.id}" has multiple bound text candidates.`,
      operationIndex,
      { elementId: container.id, candidateIds: [...candidateIds].sort() },
    );
  }
  const textId = [...candidateIds][0];
  const textElement = requireLiveElement(elementsById, textId, operationIndex);
  if (textElement.type !== "text") {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_BINDING,
      `Bound text reference "${textId}" does not point to a text element.`,
      operationIndex,
      { elementId: container.id, textId, actualType: textElement.type },
    );
  }
  if (
    textElement.containerId !== null &&
    textElement.containerId !== undefined &&
    textElement.containerId !== container.id
  ) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_BINDING,
      `Text "${textId}" is bound to a different container.`,
      operationIndex,
      {
        elementId: container.id,
        textId,
        actualContainerId: textElement.containerId,
      },
    );
  }
  return textElement;
}

function createArrowElement(
  operation: NormalizedAddEdge,
  startNode: AtomicSceneElement,
  endNode: AtomicSceneElement,
  elementCount: number,
): AtomicSceneElement {
  const startFixedPoint =
    operation.start.fixedPoint ??
    defaultFixedPoint(startNode, endNode, "start");
  const endFixedPoint =
    operation.end.fixedPoint ?? defaultFixedPoint(startNode, endNode, "end");
  const startPoint = pointOnElement(startNode, startFixedPoint);
  const endPoint = pointOnElement(endNode, endFixedPoint);
  const deltaX = endPoint[0] - startPoint[0];
  const deltaY = endPoint[1] - startPoint[1];
  const input = deepClone(operation.edgeInput);
  const points = input.points ?? [
    [0, 0],
    [deltaX, deltaY],
  ];
  const frameId =
    startNode.frameId && startNode.frameId === endNode.frameId
      ? startNode.frameId
      : null;
  const edge = {
    x: startPoint[0],
    y: startPoint[1],
    width: Math.abs(deltaX),
    height: Math.abs(deltaY),
    angle: 0,
    strokeColor: startNode.strokeColor ?? "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId,
    index: `a${elementCount}`,
    roundness: null,
    seed: stablePositiveInteger(`${operation.edgeId}:seed`),
    link: null,
    locked: false,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
    moveMidPointsWithElement: false,
    ...input,
    id: operation.edgeId,
    type: "arrow",
    version: 1,
    versionNonce: stablePositiveInteger(`${operation.edgeId}:versionNonce`),
    updated: 1,
    points,
    startBinding: {
      elementId: operation.start.elementId,
      fixedPoint: startFixedPoint,
      mode: operation.start.mode,
    },
    endBinding: {
      elementId: operation.end.elementId,
      fixedPoint: endFixedPoint,
      mode: operation.end.mode,
    },
    boundElements: null,
    isDeleted: false,
  };
  return edge;
}

function validateNewEdgeInput(
  edgeInput: Record<string, unknown>,
  edgeId: string,
  operationIndex: number,
): void {
  if (edgeInput.type !== undefined && edgeInput.type !== "arrow") {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ELEMENT_TYPE,
      `New edge "${edgeId}" must be an arrow.`,
      operationIndex,
      { elementId: edgeId, actualType: edgeInput.type },
    );
  }
  if (
    edgeInput.boundElements !== undefined &&
    edgeInput.boundElements !== null &&
    (!Array.isArray(edgeInput.boundElements) ||
      edgeInput.boundElements.length > 0)
  ) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_BINDING,
      `New edge "${edgeId}" cannot declare bound elements.`,
      operationIndex,
      { elementId: edgeId },
    );
  }
  if (edgeInput.points !== undefined) {
    if (
      !Array.isArray(edgeInput.points) ||
      edgeInput.points.length < 2 ||
      edgeInput.points.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((coordinate) => !isFiniteNumber(coordinate)),
      )
    ) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
        `New edge "${edgeId}" has invalid points.`,
        operationIndex,
        { elementId: edgeId, field: "points" },
      );
    }
  }
}

function pickEdgeInput(
  operation: Record<string, unknown>,
): Record<string, unknown> {
  const fields = [
    "x",
    "y",
    "width",
    "height",
    "angle",
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "strokeWidth",
    "strokeStyle",
    "roughness",
    "opacity",
    "groupIds",
    "frameId",
    "index",
    "roundness",
    "seed",
    "updated",
    "link",
    "locked",
    "points",
    "startArrowhead",
    "endArrowhead",
    "elbowed",
    "moveMidPointsWithElement",
  ];
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    if (operation[field] !== undefined) {
      input[field] = operation[field];
    }
  }
  return input;
}

function addBoundElement(
  element: AtomicSceneElement,
  boundElement: { id: string; type: "arrow" | "text" },
  operationIndex: number,
  setField: (
    element: AtomicSceneElement,
    field: string,
    value: unknown,
    attribution: ChangeAttribution,
  ) => void,
): void {
  const existing = element.boundElements ?? [];
  if (existing.some((item: { id?: unknown }) => item.id === boundElement.id)) {
    return;
  }
  setField(element, "boundElements", [...existing, boundElement], {
    kind: "derived",
    operationIndex,
  });
}

function validateAffectedBindings(
  elementsById: Map<string, AtomicSceneElement>,
  attributions: Map<string, Map<string, ChangeAttribution>>,
): void {
  for (const elementId of attributions.keys()) {
    const element = elementsById.get(elementId);
    if (!element || element.isDeleted) {
      continue;
    }
    if (element.type === "arrow") {
      validateArrowEndpoint(element, "startBinding", elementsById);
      validateArrowEndpoint(element, "endBinding", elementsById);
    }
    if (Array.isArray(element.boundElements)) {
      const seen = new Set<string>();
      for (const binding of element.boundElements) {
        const key = `${binding?.type}:${binding?.id}`;
        if (
          seen.has(key) ||
          (binding?.type !== "arrow" && binding?.type !== "text") ||
          typeof binding?.id !== "string"
        ) {
          invariantFailure(element.id, "boundElements");
        }
        seen.add(key);
        const boundElement = elementsById.get(binding.id);
        if (!boundElement || boundElement.isDeleted) {
          invariantFailure(element.id, "boundElements", binding.id);
        }
        if (binding.type === "text") {
          if (
            boundElement.type !== "text" ||
            boundElement.containerId !== element.id
          ) {
            invariantFailure(element.id, "boundElements", binding.id);
          }
        } else if (
          boundElement.type !== "arrow" ||
          (boundElement.startBinding?.elementId !== element.id &&
            boundElement.endBinding?.elementId !== element.id)
        ) {
          invariantFailure(element.id, "boundElements", binding.id);
        }
      }
    }
    if (element.type === "text" && element.containerId) {
      const container = elementsById.get(element.containerId);
      if (
        !container ||
        container.isDeleted ||
        !Array.isArray(container.boundElements) ||
        !container.boundElements.some(
          (binding: { id?: unknown; type?: unknown }) =>
            binding.id === element.id && binding.type === "text",
        )
      ) {
        invariantFailure(element.id, "containerId", element.containerId);
      }
    }
  }
}

function validateArrowEndpoint(
  arrow: AtomicSceneElement,
  field: "startBinding" | "endBinding",
  elementsById: Map<string, AtomicSceneElement>,
): void {
  const binding = arrow[field];
  if (!binding) {
    return;
  }
  const target = elementsById.get(binding.elementId);
  if (
    !target ||
    target.isDeleted ||
    !Array.isArray(target.boundElements) ||
    !target.boundElements.some(
      (boundElement: { id?: unknown; type?: unknown }) =>
        boundElement.id === arrow.id && boundElement.type === "arrow",
    )
  ) {
    invariantFailure(arrow.id, field, binding.elementId);
  }
}

function invariantFailure(
  elementId: unknown,
  field: string,
  relatedElementId?: unknown,
): never {
  fail(
    ATOMIC_SCENE_EDIT_ERROR_CODES.INVARIANT_VIOLATION,
    `Binding invariant failed for element "${String(elementId)}".`,
    undefined,
    { elementId, field, relatedElementId },
  );
}

function buildFieldDiffs(
  workingElements: readonly AtomicSceneElement[],
  sourceById: Map<string, AtomicSceneElement>,
  attributions: Map<string, Map<string, ChangeAttribution>>,
): AtomicSceneEditResult["diff"] {
  const direct: AtomicSceneFieldDiff[] = [];
  const derived: AtomicSceneFieldDiff[] = [];
  for (const element of workingElements) {
    if (typeof element.id !== "string" || !attributions.has(element.id)) {
      continue;
    }
    const before = sourceById.get(element.id);
    const fields = new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(element),
    ]);
    for (const field of [...fields].sort()) {
      const beforeValue = before?.[field];
      const afterValue = element[field];
      if (isDeepEqual(beforeValue, afterValue)) {
        continue;
      }
      const attribution = getAttribution(attributions, element.id, field);
      const entry = {
        operationIndex: attribution.operationIndex,
        elementId: element.id,
        field,
        before: deepClone(beforeValue),
        after: deepClone(afterValue),
      };
      (attribution.kind === "direct" ? direct : derived).push(entry);
    }
  }
  return { direct, derived };
}

function markAttribution(
  attributions: Map<string, Map<string, ChangeAttribution>>,
  elementId: string,
  field: string,
  attribution: ChangeAttribution,
): void {
  let fields = attributions.get(elementId);
  if (!fields) {
    fields = new Map();
    attributions.set(elementId, fields);
  }
  const existing = fields.get(field);
  if (!existing || attribution.kind === "derived") {
    fields.set(field, attribution);
  }
}

function getAttribution(
  attributions: Map<string, Map<string, ChangeAttribution>>,
  elementId: string,
  field: string,
): ChangeAttribution {
  const fields = attributions.get(elementId);
  return (
    fields?.get(field) ??
    fields?.get("") ?? {
      kind: "derived",
      operationIndex: firstAttributionForElement(attributions, elementId)
        .operationIndex,
    }
  );
}

function firstAttributionForElement(
  attributions: Map<string, Map<string, ChangeAttribution>>,
  elementId: string,
): ChangeAttribution {
  const values = [...(attributions.get(elementId)?.values() ?? [])];
  return (
    values.sort(
      (left, right) => left.operationIndex - right.operationIndex,
    )[0] ?? {
      kind: "derived",
      operationIndex: 0,
    }
  );
}

function setMetadataField(
  element: AtomicSceneElement,
  field: "version" | "versionNonce" | "updated",
  value: number,
  attribution: ChangeAttribution,
  attributions: Map<string, Map<string, ChangeAttribution>>,
): void {
  if (element[field] === value) {
    return;
  }
  element[field] = value;
  markAttribution(attributions, element.id as string, field, {
    kind: "derived",
    operationIndex: attribution.operationIndex,
  });
}

function indexElements(
  elements: readonly AtomicSceneElement[],
): Map<string, AtomicSceneElement> {
  const byId = new Map<string, AtomicSceneElement>();
  for (const [index, element] of elements.entries()) {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_SCENE,
        `Scene element at index ${index} is invalid.`,
        undefined,
        { index },
      );
    }
    if (typeof element.id !== "string" || element.id.length === 0) {
      if (PSEUDO_TYPES.has(element.type)) {
        continue;
      }
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_SCENE,
        `Scene element at index ${index} has no valid id.`,
        undefined,
        { index },
      );
    }
    if (byId.has(element.id)) {
      fail(
        ATOMIC_SCENE_EDIT_ERROR_CODES.DUPLICATE_ELEMENT_ID,
        `Scene contains duplicate element id "${element.id}".`,
        undefined,
        { elementId: element.id },
      );
    }
    byId.set(element.id, element);
  }
  return byId;
}

function requireLiveElement(
  elementsById: Map<string, AtomicSceneElement>,
  elementId: string,
  operationIndex: number,
): AtomicSceneElement {
  const element = elementsById.get(elementId);
  if (!element) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.ELEMENT_NOT_FOUND,
      `Element "${elementId}" was not found.`,
      operationIndex,
      { elementId },
    );
  }
  if (element.isDeleted) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.ELEMENT_DELETED,
      `Element "${elementId}" is deleted.`,
      operationIndex,
      { elementId },
    );
  }
  return element;
}

function assertElementType(
  element: AtomicSceneElement,
  allowedTypes: Set<string>,
  expectedType: string,
  operationIndex: number,
): void {
  if (!allowedTypes.has(element.type)) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ELEMENT_TYPE,
      `Element "${element.id}" is not a ${expectedType}.`,
      operationIndex,
      {
        elementId: element.id,
        expectedType,
        actualType: element.type,
      },
    );
  }
}

function assertMutableElement(
  element: AtomicSceneElement,
  operationIndex: number,
): void {
  if (
    !Number.isInteger(element.version) ||
    !Number.isInteger(element.versionNonce)
  ) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_SCENE,
      `Element "${element.id}" has invalid version metadata.`,
      operationIndex,
      { elementId: element.id },
    );
  }
}

function assertBoundElements(
  element: AtomicSceneElement,
  operationIndex: number,
): void {
  if (
    element.boundElements !== null &&
    element.boundElements !== undefined &&
    !Array.isArray(element.boundElements)
  ) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_BINDING,
      `Element "${element.id}" has invalid boundElements.`,
      operationIndex,
      { elementId: element.id },
    );
  }
}

function readFixedPoint(
  value: unknown,
  operationIndex: number,
): [number, number] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(
      (coordinate) =>
        isFiniteNumber(coordinate) && coordinate >= 0 && coordinate <= 1,
    )
  ) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
      "Binding fixedPoint must contain two ratios between 0 and 1.",
      operationIndex,
      { fixedPoint: value },
    );
  }
  return [value[0], value[1]];
}

function defaultFixedPoint(
  startNode: AtomicSceneElement,
  endNode: AtomicSceneElement,
  endpoint: "start" | "end",
): [number, number] {
  const startCenter = elementCenter(startNode);
  const endCenter = elementCenter(endNode);
  const deltaX = endCenter[0] - startCenter[0];
  const deltaY = endCenter[1] - startCenter[1];
  const isStart = endpoint === "start";
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const towardRight = deltaX >= 0;
    return [towardRight === isStart ? 1 : 0, 0.5001];
  }
  const towardBottom = deltaY >= 0;
  return [0.5001, towardBottom === isStart ? 1 : 0];
}

function elementCenter(element: AtomicSceneElement): [number, number] {
  return [
    finiteOrZero(element.x) + finiteOrZero(element.width) / 2,
    finiteOrZero(element.y) + finiteOrZero(element.height) / 2,
  ];
}

function pointOnElement(
  element: AtomicSceneElement,
  fixedPoint: [number, number],
): [number, number] {
  return [
    finiteOrZero(element.x) + finiteOrZero(element.width) * fixedPoint[0],
    finiteOrZero(element.y) + finiteOrZero(element.height) * fixedPoint[1],
  ];
}

function nextVersionNonce(
  element: AtomicSceneElement,
  fields: Map<string, ChangeAttribution> | undefined,
): number {
  const signature = [...(fields?.entries() ?? [])]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([field, attribution]) =>
        `${field}:${attribution.kind}:${attribution.operationIndex}`,
    )
    .join("|");
  let nonce = stablePositiveInteger(
    `${element.id}:${element.version}:${element.versionNonce}:${signature}`,
  );
  if (nonce === element.versionNonce) {
    nonce = nonce === 2 ** 31 - 1 ? 1 : nonce + 1;
  }
  return nonce;
}

function nextUpdatedValue(value: unknown): number {
  return isFiniteNumber(value) ? value + 1 : 1;
}

function stablePositiveInteger(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % (2 ** 31 - 1) || 1;
}

function finiteOrZero(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireString(
  value: unknown,
  operationIndex: number,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
      `Operation ${operationIndex} requires ${field}.`,
      operationIndex,
      { field },
    );
  }
  return value;
}

function asObject(
  value: unknown,
  operationIndex: number,
  field: string,
): Record<string, unknown> {
  const object = optionalObject(value);
  if (!object) {
    fail(
      ATOMIC_SCENE_EDIT_ERROR_CODES.INVALID_ARGUMENT,
      `Operation ${operationIndex} has invalid ${field}.`,
      operationIndex,
      { field },
    );
  }
  return object;
}

function optionalObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const cached = seen.get(value as object);
  if (cached) {
    return cached as T;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(deepClone(item, seen));
    }
    return clone as T;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value as object, clone);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    clone[key] = deepClone(item, seen);
  }
  return clone as T;
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }
    return left.every((value, index) => isDeepEqual(value, right[index]));
  }
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject);
  const rightKeys = Object.keys(rightObject);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightObject, key) &&
        isDeepEqual(leftObject[key], rightObject[key]),
    )
  );
}

function fail(
  code: AtomicSceneEditErrorCode,
  message: string,
  operationIndex?: number,
  details?: Record<string, unknown>,
): never {
  throw new AtomicSceneEditError(code, message, {
    operationIndex,
    details,
  });
}
