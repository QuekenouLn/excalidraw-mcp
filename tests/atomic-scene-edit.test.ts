import { isDeepStrictEqual } from "node:util";

import { describe, expect, test } from "bun:test";

import {
  ATOMIC_SCENE_EDIT_ERROR_CODES,
  AtomicSceneEditError,
  applyAtomicSceneEdit,
  type AtomicSceneEditResult,
  type AtomicSceneElement,
} from "../src/atomic-scene-edit";
import { convertElementsForStorage } from "../src/server-element-conversion";
import { routeNativeElbowArrow } from "../src/native-derived-geometry.js";

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
  const resultById = new Map(
    result.elements.map((element) => [element.id, element]),
  );
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
  const reportedChanges = diff.map(
    ({ elementId, field }) => `${elementId}.${field}`,
  );
  expect(new Set(reportedChanges).size).toBe(reportedChanges.length);
  expect(reportedChanges.sort()).toEqual(actualChanges.sort());

  for (const change of diff) {
    expect(change.before).toEqual(
      sourceById.get(change.elementId)?.[change.field],
    );
    expect(change.after).toEqual(
      resultById.get(change.elementId)?.[change.field],
    );
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

const expectPointOnElementBoundary = (
  point: readonly [number, number],
  element: AtomicSceneElement,
) => {
  const tolerance = 1.01;
  const left = element.x;
  const right = element.x + element.width;
  const top = element.y;
  const bottom = element.y + element.height;
  const onVerticalEdge =
    (Math.abs(point[0] - left) <= tolerance ||
      Math.abs(point[0] - right) <= tolerance) &&
    point[1] >= top - tolerance &&
    point[1] <= bottom + tolerance;
  const onHorizontalEdge =
    (Math.abs(point[1] - top) <= tolerance ||
      Math.abs(point[1] - bottom) <= tolerance) &&
    point[0] >= left - tolerance &&
    point[0] <= right + tolerance;

  expect(onVerticalEdge || onHorizontalEdge).toBe(true);
};

describe("atomic scene editing", () => {
  test("creates centered safe labels and boundary-bound arrows after nodes move", () => {
    const restored = convertElementsForStorage([
      {
        id: "moved-source",
        type: "rectangle",
        x: 120,
        y: 260,
        width: 240,
        height: 100,
        label: { text: "平台防御", fontSize: 20, fontFamily: 11 },
      },
      {
        id: "moved-target",
        type: "rectangle",
        x: 560,
        y: 260,
        width: 240,
        height: 100,
      },
      {
        id: "moved-connector",
        type: "arrow",
        x: 360,
        y: 310,
        width: 200,
        height: 0,
        points: [
          [0, 0],
          [200, 0],
        ],
        start: { id: "moved-source", fixedPoint: [1, 0.5] },
        end: { id: "moved-target", fixedPoint: [0, 0.5] },
      },
    ]) as AtomicSceneElement[];
    const node = getElement(restored, "moved-source");
    const target = getElement(restored, "moved-target");
    const label = getElement(restored, "moved-source__label");
    const arrow = getElement(restored, "moved-connector");
    const startPoint = [
      arrow.x + arrow.points[0][0],
      arrow.y + arrow.points[0][1],
    ] as const;
    const endPoint = [
      arrow.x + arrow.points.at(-1)[0],
      arrow.y + arrow.points.at(-1)[1],
    ] as const;

    expect(label.containerId).toBe(node.id);
    expect(label.width).toBeGreaterThanOrEqual(88);
    expect(label.x + label.width / 2).toBeCloseTo(node.x + node.width / 2);
    expect(label.y + label.height / 2).toBeCloseTo(node.y + node.height / 2);
    expect(arrow.startBinding?.elementId).toBe(node.id);
    expect(arrow.endBinding?.elementId).toBe(target.id);
    expectPointOnElementBoundary(startPoint, node);
    expectPointOnElementBoundary(endPoint, target);
  });

  test("create_view conversion defaults new arrows to native elbow and respects explicit sharp", () => {
    const makeScene = (elbowed?: boolean) =>
      convertElementsForStorage([
        { id: "left", type: "rectangle", x: 0, y: 0, width: 100, height: 80 },
        {
          id: "right",
          type: "rectangle",
          x: 400,
          y: 160,
          width: 100,
          height: 80,
        },
        {
          id: "connector",
          type: "arrow",
          x: 100,
          y: 40,
          width: 300,
          height: 160,
          points: [
            [0, 0],
            [300, 160],
          ],
          start: { id: "left" },
          end: { id: "right" },
          label: { text: "calls" },
          ...(elbowed === undefined ? {} : { elbowed }),
        },
      ]) as AtomicSceneElement[];
    const native = getElement(makeScene(), "connector");
    expect(native.elbowed).toBe(true);
    expect(native.roundness).toBeNull();
    expect(native.startBinding.elementId).toBe("left");
    expect(native.endBinding.elementId).toBe("right");
    expect(native.points.length).toBeGreaterThan(2);
    expect(
      native.points.every(
        (point: number[], index: number) =>
          index === 0 ||
          point[0] === native.points[index - 1][0] ||
          point[1] === native.points[index - 1][1],
      ),
    ).toBe(true);
    const label = getElement(makeScene(), "connector__label");
    expect(label.containerId).toBe(native.id);
    expect(getElement(makeScene(false), "connector").elbowed).toBe(false);
  });

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
      elbowed: true,
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
    expect(result.affectedElementIds).toEqual([start.id, end.id, edgeId]);
    expect(
      result.diff.direct.some((change) => change.elementId === edgeId),
    ).toBe(true);
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

  test("converts an existing labeled arrow to native elbow without replacing its bindings", () => {
    const source = asAtomicElements(createAtomicScene());
    const snapshot = structuredClone(source);
    const edge = getElement(source, ATOMIC_SCENE_IDS.arrows.forward);
    const label = getElement(source, ATOMIC_SCENE_IDS.arrowTexts.forward);
    const result = applyAtomicSceneEdit(source, [
      {
        type: "set_arrow_type",
        edge: { id: edge.id as string, ...versionExpectation(edge) },
        arrowType: "elbow",
      },
    ]);
    const converted = getElement(result.elements, edge.id as string);
    const convertedLabel = getElement(result.elements, label.id as string);
    expect(converted.elbowed).toBe(true);
    expect(converted.roundness).toBeNull();
    expect(converted.startBinding).toEqual(edge.startBinding);
    expect(converted.endBinding).toEqual(edge.endBinding);
    expect(converted.boundElements).toEqual(edge.boundElements);
    expect(
      converted.points.every(
        (point: number[], index: number) =>
          index === 0 ||
          point[0] === converted.points[index - 1][0] ||
          point[1] === converted.points[index - 1][1],
      ),
    ).toBe(true);
    expect(convertedLabel.containerId).toBe(edge.id);
    expect(convertedLabel.text).toBe(label.text);
    expect(converted.version).toBe(edge.version + 1);
    assertAtomicSceneBidirectionalBindings(result.elements as never);
    expectCompleteDiff(source, result);
    expect(source).toEqual(snapshot);

    const unchanged = applyAtomicSceneEdit(result.elements, [
      {
        type: "set_arrow_type",
        edge: { id: edge.id as string, ...versionExpectation(converted) },
        arrowType: "elbow",
      },
    ]);
    expect(unchanged.elements).toEqual(result.elements);
    expect(unchanged.affectedElementIds).toEqual([]);

    const sharp = applyAtomicSceneEdit(result.elements, [
      {
        type: "set_arrow_type",
        edge: { id: edge.id as string, ...versionExpectation(converted) },
        arrowType: "sharp",
      },
    ]);
    expect(getElement(sharp.elements, edge.id as string)).toMatchObject({
      elbowed: false,
      roundness: null,
      points: [converted.points[0], converted.points.at(-1)],
    });
    const straight = getElement(sharp.elements, edge.id as string);
    const round = applyAtomicSceneEdit(sharp.elements, [
      {
        type: "set_arrow_type",
        edge: { id: edge.id as string, ...versionExpectation(straight) },
        arrowType: "round",
      },
    ]);
    expect(getElement(round.elements, edge.id as string)).toMatchObject({
      elbowed: false,
      roundness: { type: 2 },
    });

    const moved = new Map(
      result.elements.map((element) => [element.id, structuredClone(element)]),
    );
    const target = moved.get(edge.endBinding.elementId)!;
    target.y += 120;
    const rerouted = routeNativeElbowArrow(converted, moved);
    expect(rerouted.points).not.toEqual(converted.points);
    expect(
      rerouted.points.every(
        (point: number[], index: number) =>
          index === 0 ||
          point[0] === rerouted.points[index - 1][0] ||
          point[1] === rerouted.points[index - 1][1],
      ),
    ).toBe(true);

    const stale = captureAtomicError(() =>
      applyAtomicSceneEdit(result.elements, [
        {
          type: "set_arrow_type",
          edge: { id: edge.id as string, ...versionExpectation(edge) },
          arrowType: "sharp",
        },
      ]),
    );
    expect(stale.code).toBe(ATOMIC_SCENE_EDIT_ERROR_CODES.VERSION_CONFLICT);
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
      originalText: "updated edge label",
      containerId: edge.id,
      version: label.version + 1,
    });
    expect(updatedLabel.text.replace("\n", " ")).toBe("updated edge label");
    expect(updatedLabel.width).toBeGreaterThan(label.width);
    expect(updatedLabel.height).toBeGreaterThanOrEqual(label.height);
    expect(updatedEdge).toEqual(edge);
    expect(result.diff.direct).toEqual([
      expect.objectContaining({
        elementId: label.id,
        field: "originalText",
        before: label.originalText,
        after: "updated edge label",
      }),
    ]);
    expect(result.diff.derived).toContainEqual(
      expect.objectContaining({
        elementId: label.id,
        field: "text",
        before: label.text,
        after: updatedLabel.text,
      }),
    );
    expect(result.diff.derived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ elementId: label.id, field: "width" }),
        expect.objectContaining({ elementId: label.id, field: "height" }),
        expect.objectContaining({ elementId: label.id, field: "x" }),
        expect.objectContaining({ elementId: label.id, field: "y" }),
        expect.objectContaining({ elementId: label.id, field: "updated" }),
        expect.objectContaining({ elementId: label.id, field: "version" }),
        expect.objectContaining({ elementId: label.id, field: "versionNonce" }),
      ]),
    );
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
      version: label.version + 1,
    });
    expect(updatedLabel.width).toBeGreaterThan(label.width);
    expect(updatedLabel.x + updatedLabel.width / 2).toBeCloseTo(
      node.x + node.width / 2,
    );
    expect(updatedLabel.y + updatedLabel.height / 2).toBeCloseTo(
      node.y + node.height / 2,
    );
    expect(result.affectedElementIds).toEqual([label.id]);
    expect(
      result.diff.direct.every(({ operationIndex }) => operationIndex === 0),
    ).toBe(true);
    expect(
      result.diff.derived.every(({ operationIndex }) => operationIndex === 0),
    ).toBe(true);
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
    expect(getElement(source, ATOMIC_SCENE_IDS.arrowTexts.forward).text).toBe(
      edgeLabel.text,
    );
  });
});
