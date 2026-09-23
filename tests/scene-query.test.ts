import { describe, expect, test } from "bun:test";

import {
  SceneQueryError,
  getSceneElementById,
  inspectBoundText,
  projectSceneGraph,
  querySceneElements,
  resolveBoundTextElement,
  resolveSceneElement,
  resolveSceneElementByText,
} from "../src/scene-query";

import {
  ATOMIC_SCENE_IDS,
  createAtomicScene,
  mapElementsById,
} from "./fixtures/atomic-scene";

const expectSceneQueryError = (
  operation: () => unknown,
  code: SceneQueryError["code"],
) => {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(SceneQueryError);
    if (!(error instanceof SceneQueryError)) {
      throw error;
    }
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error(`Expected SceneQueryError with code ${code}`);
};

describe("scene element queries", () => {
  test("selects an exact id with version and bound text metadata", () => {
    const elements = createAtomicScene();
    const source = mapElementsById(elements).get(ATOMIC_SCENE_IDS.nodes.a)!;
    const result = querySceneElements(elements, {
      id: ATOMIC_SCENE_IDS.nodes.a,
    });

    expect(result.total).toBe(1);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      id: ATOMIC_SCENE_IDS.nodes.a,
      type: "rectangle",
      text: "Alpha",
      version: source.version,
      versionNonce: source.versionNonce,
      boundText: {
        id: ATOMIC_SCENE_IDS.nodeTexts.a,
        containerId: ATOMIC_SCENE_IDS.nodes.a,
        text: "Alpha",
      },
      boundTextResolution: { status: "bound", issues: [] },
    });
    expect(getSceneElementById(elements, ATOMIC_SCENE_IDS.nodes.a)).toBe(
      source,
    );
  });

  test("filters container labels by exact and contains text", () => {
    const elements = createAtomicScene();

    expect(resolveSceneElementByText(elements, "beta")).toMatchObject({
      id: ATOMIC_SCENE_IDS.nodes.b,
      type: "rectangle",
    });
    expect(
      querySceneElements(elements, {
        text: "a",
        textMatch: "contains",
        type: "rectangle",
      }).elements.map(({ id }) => id),
    ).toEqual([
      ATOMIC_SCENE_IDS.nodes.a,
      ATOMIC_SCENE_IDS.nodes.b,
      ATOMIC_SCENE_IDS.nodes.c,
    ]);
    expect(
      querySceneElements(elements, {
        text: "alpha",
        caseSensitive: true,
      }).total,
    ).toBe(0);
  });

  test("reports stable ambiguity and missing errors", () => {
    const elements = createAtomicScene();

    const ambiguous = expectSceneQueryError(
      () =>
        resolveSceneElement(elements, {
          text: "a",
          textMatch: "contains",
          type: "rectangle",
        }),
      "ELEMENT_AMBIGUOUS",
    );
    expect(ambiguous.details).toMatchObject({
      elementIds: [
        ATOMIC_SCENE_IDS.nodes.a,
        ATOMIC_SCENE_IDS.nodes.b,
        ATOMIC_SCENE_IDS.nodes.c,
      ],
    });

    expectSceneQueryError(
      () => getSceneElementById(elements, "missing-element"),
      "ELEMENT_NOT_FOUND",
    );
    expectSceneQueryError(
      () => resolveSceneElementByText(elements, "Delta"),
      "ELEMENT_NOT_FOUND",
    );
  });

  test("rejects duplicate exact ids as ambiguous", () => {
    const elements: any[] = createAtomicScene();
    elements.push({ ...elements[0] });

    expectSceneQueryError(
      () => getSceneElementById(elements, ATOMIC_SCENE_IDS.nodes.a),
      "ELEMENT_AMBIGUOUS",
    );
  });
});

describe("bound text resolution", () => {
  test("resolves node and arrow labels through both binding directions", () => {
    const elements = createAtomicScene();
    const elementsById = mapElementsById(elements);

    expect(inspectBoundText(elements, ATOMIC_SCENE_IDS.nodes.a)).toMatchObject({
      status: "bound",
      containerId: ATOMIC_SCENE_IDS.nodes.a,
      textElementId: ATOMIC_SCENE_IDS.nodeTexts.a,
      boundText: {
        id: ATOMIC_SCENE_IDS.nodeTexts.a,
        text: "Alpha",
        version: 1,
      },
      issues: [],
    });
    expect(
      resolveBoundTextElement(elements, ATOMIC_SCENE_IDS.arrows.forward),
    ).toBe(elementsById.get(ATOMIC_SCENE_IDS.arrowTexts.forward));
    expect(
      inspectBoundText(elements, ATOMIC_SCENE_IDS.arrows.forward),
    ).toMatchObject({
      status: "bound",
      boundText: {
        id: ATOMIC_SCENE_IDS.arrowTexts.forward,
        containerId: ATOMIC_SCENE_IDS.arrows.forward,
        text: "forward edge",
      },
    });
    expect(
      inspectBoundText(elements, ATOMIC_SCENE_IDS.unrelated),
    ).toMatchObject({
      status: "none",
      textElementId: null,
      boundText: null,
      issues: [],
    });
  });

  test("distinguishes broken and ambiguous bound text", () => {
    const broken: any[] = createAtomicScene().filter(
      ({ id }) => id !== ATOMIC_SCENE_IDS.nodeTexts.a,
    );
    expect(inspectBoundText(broken, ATOMIC_SCENE_IDS.nodes.a)).toMatchObject({
      status: "broken",
      boundText: null,
      issues: [{ code: "TEXT_ELEMENT_MISSING" }],
    });
    expectSceneQueryError(
      () => resolveBoundTextElement(broken, ATOMIC_SCENE_IDS.nodes.a),
      "BOUND_TEXT_BROKEN",
    );

    const ambiguous: any[] = createAtomicScene();
    const extraText = {
      ...ambiguous.find(({ id }) => id === ATOMIC_SCENE_IDS.nodeTexts.a),
      id: "node-a-text-extra",
    };
    ambiguous.push(extraText);
    const resolution = inspectBoundText(ambiguous, ATOMIC_SCENE_IDS.nodes.a);
    expect(resolution).toMatchObject({
      status: "ambiguous",
      textElementId: null,
      boundText: null,
    });
    expect(resolution.issues.map(({ code }) => code)).toContain(
      "MULTIPLE_BOUND_TEXTS",
    );
    expectSceneQueryError(
      () => resolveBoundTextElement(ambiguous, ATOMIC_SCENE_IDS.nodes.a),
      "BOUND_TEXT_AMBIGUOUS",
    );
  });
});

describe("scene graph projection", () => {
  test("projects nodes and bound labels without text nodes", () => {
    const graph = projectSceneGraph(createAtomicScene());

    expect(graph.nodes.map(({ id }) => id)).toEqual([
      ATOMIC_SCENE_IDS.nodes.a,
      ATOMIC_SCENE_IDS.nodes.b,
      ATOMIC_SCENE_IDS.nodes.c,
      ATOMIC_SCENE_IDS.unrelated,
    ]);
    expect(
      graph.nodes.find(({ id }) => id === ATOMIC_SCENE_IDS.nodes.a),
    ).toMatchObject({
      text: "Alpha",
      version: 1,
      boundText: { id: ATOMIC_SCENE_IDS.nodeTexts.a, text: "Alpha" },
    });
    expect(graph.edges).toHaveLength(5);
  });

  test("projects forward, reverse, bidirectional, and undirected arrows", () => {
    const edges = new Map(
      projectSceneGraph(createAtomicScene()).edges.map((edge) => [
        edge.id,
        edge,
      ]),
    );
    const { arrows, nodes } = ATOMIC_SCENE_IDS;

    expect(edges.get(arrows.forward)).toMatchObject({
      arrowheadMode: "end-only",
      direction: "forward",
      sourceId: nodes.a,
      targetId: nodes.b,
      start: { status: "bound", nodeId: nodes.a },
      end: { status: "bound", nodeId: nodes.b },
      text: "forward edge",
      boundText: { id: ATOMIC_SCENE_IDS.arrowTexts.forward },
    });
    expect(
      edges
        .get(arrows.forward)!
        .directedRelations.map(({ from, to }) => [from.nodeId, to.nodeId]),
    ).toEqual([[nodes.a, nodes.b]]);

    expect(edges.get(arrows.reverse)).toMatchObject({
      arrowheadMode: "start-only",
      direction: "reverse",
      sourceId: nodes.b,
      targetId: nodes.a,
      start: { nodeId: nodes.a },
      end: { nodeId: nodes.b },
    });
    expect(
      edges
        .get(arrows.reverse)!
        .directedRelations.map(({ from, to }) => [from.nodeId, to.nodeId]),
    ).toEqual([[nodes.b, nodes.a]]);

    expect(edges.get(arrows.bidirectional)).toMatchObject({
      arrowheadMode: "both",
      direction: "bidirectional",
    });
    expect(
      edges
        .get(arrows.bidirectional)!
        .directedRelations.map(({ from, to }) => [from.nodeId, to.nodeId]),
    ).toEqual([
      [nodes.a, nodes.b],
      [nodes.b, nodes.a],
    ]);

    expect(edges.get(arrows.undirected)).toMatchObject({
      arrowheadMode: "none",
      direction: "undirected",
      sourceId: nodes.a,
      targetId: nodes.b,
      directedRelations: [],
    });
  });

  test("preserves free and broken dangling endpoints", () => {
    const { arrows, nodes } = ATOMIC_SCENE_IDS;
    const dangling = projectSceneGraph(createAtomicScene()).edges.find(
      ({ id }) => id === arrows.dangling,
    )!;

    expect(dangling).toMatchObject({
      direction: "forward",
      sourceId: nodes.a,
      targetId: null,
      start: { status: "bound", elementId: nodes.a, nodeId: nodes.a },
      end: {
        status: "free",
        elementId: null,
        nodeId: null,
        binding: null,
      },
    });
    expect(
      dangling.directedRelations.map(({ from, to }) => [
        from.nodeId,
        to.nodeId,
      ]),
    ).toEqual([[nodes.a, null]]);

    const brokenElements: any[] = createAtomicScene();
    const brokenArrow = brokenElements.find(({ id }) => id === arrows.dangling);
    brokenArrow.endBinding = {
      elementId: "missing-node",
      focus: 0,
      gap: 1,
    };
    const brokenEdge = projectSceneGraph(brokenElements).edges.find(
      ({ id }) => id === arrows.dangling,
    )!;
    expect(brokenEdge.end).toMatchObject({
      status: "broken",
      elementId: "missing-node",
      nodeId: null,
      elementType: null,
    });
  });
});

test("all shipped scene query functions leave input deeply unchanged", () => {
  const elements = createAtomicScene();
  const before = structuredClone(elements);

  querySceneElements(elements, { text: "a", textMatch: "contains" });
  getSceneElementById(elements, ATOMIC_SCENE_IDS.nodes.a);
  resolveSceneElementByText(elements, "Alpha");
  inspectBoundText(elements, ATOMIC_SCENE_IDS.nodes.a);
  resolveBoundTextElement(elements, ATOMIC_SCENE_IDS.arrows.forward);
  projectSceneGraph(elements);

  expect(elements).toEqual(before);
});
