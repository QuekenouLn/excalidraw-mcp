import { isDeepStrictEqual } from "node:util";
import { describe, expect, test } from "bun:test";
import {
  ATOMIC_SCENE_EDIT_ERROR_CODES,
  AtomicSceneEditError,
  applyAtomicSceneEdit,
  type AtomicSceneEditResult,
  type AtomicSceneElement,
} from "../src/atomic-scene-edit";
import {
  ATOMIC_SCENE_IDS,
  assertAtomicSceneBidirectionalBindings,
  createAtomicScene,
  mapElementsById,
} from "./fixtures/atomic-scene";

const asAtomicElements = (elements: ReturnType<typeof createAtomicScene>) =>
  elements as unknown as AtomicSceneElement[];

const versionExpectation = (element: AtomicSceneElement) => ({
  version: element.version,
  versionNonce: element.versionNonce,
});

const getElement = (
  elements: readonly AtomicSceneElement[],
  elementId: string,
): AtomicSceneElement => {
  const element = elements.find((candidate) => candidate.id === elementId);
  expect(element).toBeDefined();
  return element as AtomicSceneElement;
};

const expectCompleteDiff = (
  source: readonly AtomicSceneElement[],
  result: AtomicSceneEditResult,
) => {
  const sourceById = new Map(source.map((element) => [element.id, element]));
  const resultById = new Map(result.elements.map((element) => [element.id, element]));
  const actualChanges: string[] = [];

  for (const element of result.elements) {
    const before = sourceById.get(element.id);
    const fields = new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(element),
    ]);
    for (const field of fields) {
      if (!isDeepStrictEqual(before?.[field], element[field])) {
        actualChanges.push(`${element.id}.${field}`);
      }
    }
  }

  const diff = [...result.diff.direct, ...result.diff.derived];
  const reportedChanges = diff.map(({ elementId, field }) =>
    `${elementId}.${field}`,
  );
  expect(new Set(reportedChanges).size).toBe(reportedChanges.length);
  expect(reportedChanges.sort()).toEqual(actualChanges.sort());

  for (const change of diff) {
    expect(change.before).toEqual(sourceById.get(change.elementId)?.[change.field]);
    expect(change.after).toEqual(resultById.get(change.elementId)?.[change.field]);
  }
};

const expectUnrelatedElementPreserved = (
  source: readonly AtomicSceneElement[],
  result: AtomicSceneEditResult,
) => {
  expect(getElement(result.elements, ATOMIC_SCENE_IDS.unrelated)).toEqual(
    getElement(source, ATOMIC_SCENE_IDS.unrelated),
  );
};

const captureAtomicError = (callback: () => unknown): AtomicSceneEditError => {
  let caught: unknown;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AtomicSceneEditError);
  return caught as AtomicSceneEditError;
};

describe("atomic scene editing", () => {
  test("add_edge creates an arrow with bidirectional references and an auditable diff", () => {
    const source = asAtomicElements(createAtomicScene());
    const snapshot = structuredClone(source);
    const start = getElement(source, ATOMIC_SCENE_IDS.nodes.b);
    const end = getElement(source, ATOMIC_SCENE_IDS.nodes.c);
    const edgeId = "arrow-b-to-c";

    const result = applyAtomicSceneEdit(source, [
      {
        type: "add_edge",
        edgeId,
        start: { id: start.id, ...versionExpectation(start) },
        end: { id: end.id, ...versionExpectation(end) },
      },
    ]);
    const elementsById = mapElementsById(result.elements as never);
    const edge = elementsById.get(edgeId);
    const updatedStart = elementsById.get(start.id as string);
    const updatedEnd = elementsById.get(end.id as string);

    expect(edge).toMatchObject({
      id: edgeId,
      type: "arrow",
      startBinding: { elementId: start.id, mode: "orbit" },
      endBinding: { elementId: end.id, mode: "orbit" },
      startArrowhead: null,
      endArrowhead: "arrow",
      version: 1,
      isDeleted: false,
    });
    expect(updatedStart?.boundElements).toContainEqual({
      id: edgeId,
      type: "arrow",
    });
    expect(updatedEnd?.boundElements).toContainEqual({
      id: edgeId,
      type: "arrow",
    });
    expect(
      updatedStart?.boundElements?.filter(({ id }) => id === edgeId),
    ).toHaveLength(1);
    expect(
      updatedEnd?.boundElements?.filter(({ id }) => id === edgeId),
    ).toHaveLength(1);
    expect(result.affectedElementIds).toEqual([
      start.id,
      end.id,
      edgeId,
    ]);
    expect(result.diff.direct.some((change) => change.elementId === edgeId)).toBe(
      true,
    );
    expect(result.diff.derived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationIndex: 0,
          elementId: start.id,
          field: "boundElements",
        }),
        expect.objectContaining({
          operationIndex: 0,
          elementId: end.id,
          field: "boundElements",
        }),
      ]),
    );
    assertAtomicSceneBidirectionalBindings(result.elements as never);
    expectCompleteDiff(source, result);
    expectUnrelatedElementPreserved(source, result);
    expect(source).toEqual(snapshot);
  });

  test("set_edge_label updates only bound text content and derived metadata", () => {
    const source = asAtomicElements(createAtomicScene());
    const snapshot = structuredClone(source);
    const edge = getElement(source, ATOMIC_SCENE_IDS.arrows.forward);
    const label = getElement(source, ATOMIC_SCENE_IDS.arrowTexts.forward);

    const result = applyAtomicSceneEdit({
      elements: source,
      operations: [
        {
          type: "set_edge_label",
          edge: { id: edge.id, ...versionExpectation(edge) },
          text: "updated edge label",
        },
      ],
    });
    const updatedEdge = getElement(result.elements, edge.id as string);
    const updatedLabel = getElement(result.elements, label.id as string);

    expect(updatedLabel).toMatchObject({
      text: "updated edge label",
      originalText: "updated edge label",
      containerId: edge.id,
      x: label.x,
      y: label.y,
      width: label.width,
      height: label.height,
      version: label.version + 1,
    });
    expect(updatedEdge).toEqual(edge);
    expect(result.diff.direct).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: label.id,
          field: "text",
          before: label.text,
          after: "updated edge label",
        }),
        expect.objectContaining({
          elementId: label.id,
          field: "originalText",
          before: label.originalText,
          after: "updated edge label",
        }),
      ]),
    );
    expect(result.diff.derived.map(({ field }) => field).sort()).toEqual([
      "updated",
      "version",
      "versionNonce",
    ]);
    assertAtomicSceneBidirectionalBindings(result.elements as never);
    expectCompleteDiff(source, result);
    expectUnrelatedElementPreserved(source, result);
    expect(source).toEqual(snapshot);
  });

  test("set_node_label preserves the node-text relationship and unrelated elements", () => {
    const source = asAtomicElements(createAtomicScene());
    const snapshot = structuredClone(source);
    const node = getElement(source, ATOMIC_SCENE_IDS.nodes.c);
    const label = getElement(source, ATOMIC_SCENE_IDS.nodeTexts.c);

    const result = applyAtomicSceneEdit(source, [
      {
        type: "set_node_label",
        node: { id: node.id, ...versionExpectation(node) },
        text: "Updated Gamma",
      },
    ]);
    const updatedNode = getElement(result.elements, node.id as string);
    const updatedLabel = getElement(result.elements, label.id as string);

    expect(updatedNode).toEqual(node);
    expect(updatedNode.boundElements).toContainEqual({
      id: label.id,
      type: "text",
    });
    expect(updatedLabel).toMatchObject({
      text: "Updated Gamma",
      originalText: "Updated Gamma",
      containerId: node.id,
      x: label.x,
      y: label.y,
      width: label.width,
      height: label.height,
      version: label.version + 1,
    });
    expect(result.affectedElementIds).toEqual([label.id]);
    expect(result.diff.direct.every(({ operationIndex }) => operationIndex === 0)).toBe(
      true,
    );
    expect(result.diff.derived.every(({ operationIndex }) => operationIndex === 0)).toBe(
      true,
    );
    assertAtomicSceneBidirectionalBindings(result.elements as never);
    expectCompleteDiff(source, result);
    expectUnrelatedElementPreserved(source, result);
    expect(source).toEqual(snapshot);
  });

  test.each([
    ["version", { versionOffset: 1, nonceOffset: 0 }],
    ["versionNonce", { versionOffset: 0, nonceOffset: 1 }],
  ] as const)(
    "rejects a stale %s precondition without mutating the source",
    (field, offsets) => {
      const source = asAtomicElements(createAtomicScene());
      const snapshot = structuredClone(source);
      const node = getElement(source, ATOMIC_SCENE_IDS.nodes.a);

      const error = captureAtomicError(() =>
        applyAtomicSceneEdit(source, [
          {
            type: "set_node_label",
            node: {
              id: node.id,
              version: node.version + offsets.versionOffset,
              versionNonce: node.versionNonce + offsets.nonceOffset,
            },
            text: "must not be applied",
          },
        ]),
      );

      expect(error.code).toBe(ATOMIC_SCENE_EDIT_ERROR_CODES.VERSION_CONFLICT);
      expect(error.operationIndex).toBe(0);
      expect(error.details).toMatchObject({ elementId: node.id, field });
      expect(source).toEqual(snapshot);
    },
  );

  test("rejects a later invalid operation with no result or partial mutation", () => {
    const source = asAtomicElements(createAtomicScene());
    const snapshot = structuredClone(source);
    const edge = getElement(source, ATOMIC_SCENE_IDS.arrows.forward);
    const edgeLabel = getElement(source, ATOMIC_SCENE_IDS.arrowTexts.forward);
    let result: AtomicSceneEditResult | undefined;

    const error = captureAtomicError(() => {
      result = applyAtomicSceneEdit(source, [
        {
          type: "set_edge_label",
          edge: { id: edge.id, ...versionExpectation(edge) },
          text: "first operation would change this",
        },
        {
          type: "set_node_label",
          node: { id: "missing-node", version: 1, versionNonce: 1 },
          text: "second operation fails",
        },
      ]);
    });

    expect(error.code).toBe(ATOMIC_SCENE_EDIT_ERROR_CODES.ELEMENT_NOT_FOUND);
    expect(error.operationIndex).toBe(1);
    expect(result).toBeUndefined();
    expect(source).toEqual(snapshot);
    expect(
      getElement(source, ATOMIC_SCENE_IDS.arrowTexts.forward).text,
    ).toBe(edgeLabel.text);
  });
});
