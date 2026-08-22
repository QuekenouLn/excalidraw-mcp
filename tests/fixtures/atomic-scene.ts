import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
  PointBinding,
} from "@excalidraw/excalidraw/element/types";

type ElementByIdMap = Map<string, ExcalidrawElement>;
type NativePointBinding = PointBinding & {
  fixedPoint: [number, number];
  mode: "orbit";
};

export const ATOMIC_SCENE_IDS = {
  nodes: {
    a: "node-a",
    b: "node-b",
    c: "node-c",
  },
  nodeTexts: {
    a: "node-a-text",
    b: "node-b-text",
    c: "node-c-text",
  },
  arrows: {
    forward: "arrow-forward",
    reverse: "arrow-reverse",
    bidirectional: "arrow-bidirectional",
    undirected: "arrow-undirected",
    dangling: "arrow-dangling",
  },
  arrowTexts: {
    forward: "arrow-forward-text",
  },
  unrelated: "unrelated-ellipse",
} as const;

const baseElement = (id: string, index: string) => ({
  id,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid" as const,
  strokeWidth: 1,
  strokeStyle: "solid" as const,
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: index as ExcalidrawElement["index"],
  roundness: null,
  seed: index.charCodeAt(0) * 100 + Number(index.slice(1)),
  version: 1,
  versionNonce: index.charCodeAt(0) * 1000 + Number(index.slice(1)),
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const rectangle = (
  id: string,
  textId: string,
  index: string,
  x: number,
  y: number,
  arrowIds: readonly string[],
): ExcalidrawElement => ({
  ...baseElement(id, index),
  type: "rectangle",
  x,
  y,
  width: 180,
  height: 100,
  backgroundColor: "#e7f5ff",
  roundness: { type: 3 },
  boundElements: [
    { id: textId, type: "text" },
    ...arrowIds.map((arrowId) => ({ id: arrowId, type: "arrow" as const })),
  ],
});

const boundText = (
  id: string,
  containerId: string,
  index: string,
  text: string,
  x: number,
  y: number,
  width: number,
): ExcalidrawElement => ({
  ...baseElement(id, index),
  type: "text",
  x,
  y,
  width,
  height: 24,
  strokeColor: "#1e1e1e",
  text,
  fontSize: 20,
  fontFamily: 5,
  textAlign: "center",
  verticalAlign: "middle",
  containerId,
  originalText: text,
  autoResize: true,
  lineHeight: 1.2 as ExcalidrawTextElement["lineHeight"],
});

const binding = (
  elementId: string,
  fixedPoint: [number, number],
): NativePointBinding => ({
  elementId,
  focus: 0,
  gap: 1,
  fixedPoint,
  mode: "orbit",
});

const arrow = (
  id: string,
  index: string,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  startBinding: NativePointBinding | null,
  endBinding: NativePointBinding | null,
  startArrowhead: "arrow" | null,
  endArrowhead: "arrow" | null,
  textId?: string,
): ExcalidrawElement => ({
  ...baseElement(id, index),
  type: "arrow",
  x,
  y,
  width: Math.abs(deltaX),
  height: Math.abs(deltaY),
  points: [
    [0, 0],
    [deltaX, deltaY],
  ] as ExcalidrawArrowElement["points"],
  lastCommittedPoint: null,
  startBinding,
  endBinding,
  startArrowhead,
  endArrowhead,
  elbowed: false,
  boundElements: textId ? [{ id: textId, type: "text" }] : null,
});

export const createAtomicScene = (): ExcalidrawElement[] => {
  const { arrows, arrowTexts, nodes, nodeTexts, unrelated } = ATOMIC_SCENE_IDS;

  return [
    rectangle(nodes.a, nodeTexts.a, "a0", 0, 100, [
      arrows.forward,
      arrows.reverse,
      arrows.bidirectional,
      arrows.undirected,
      arrows.dangling,
    ]),
    boundText(nodeTexts.a, nodes.a, "a1", "Alpha", 60, 138, 60),
    rectangle(nodes.b, nodeTexts.b, "a2", 360, 0, [
      arrows.forward,
      arrows.reverse,
      arrows.bidirectional,
      arrows.undirected,
    ]),
    boundText(nodeTexts.b, nodes.b, "a3", "Beta", 420, 38, 60),
    rectangle(nodes.c, nodeTexts.c, "a4", 360, 240, []),
    boundText(nodeTexts.c, nodes.c, "a5", "Gamma", 410, 278, 80),
    arrow(
      arrows.forward,
      "a6",
      180,
      125,
      180,
      -75,
      binding(nodes.a, [1, 0.25]),
      binding(nodes.b, [0, 0.5]),
      null,
      "arrow",
      arrowTexts.forward,
    ),
    boundText(
      arrowTexts.forward,
      arrows.forward,
      "a7",
      "forward edge",
      225,
      76,
      120,
    ),
    arrow(
      arrows.reverse,
      "a8",
      180,
      145,
      180,
      -55,
      binding(nodes.a, [1, 0.45]),
      binding(nodes.b, [0, 0.7]),
      "arrow",
      null,
    ),
    arrow(
      arrows.bidirectional,
      "a9",
      180,
      165,
      180,
      -35,
      binding(nodes.a, [1, 0.65]),
      binding(nodes.b, [0, 0.85]),
      "arrow",
      "arrow",
    ),
    arrow(
      arrows.undirected,
      "a10",
      180,
      185,
      180,
      -15,
      binding(nodes.a, [1, 0.85]),
      binding(nodes.b, [0, 0.95]),
      null,
      null,
    ),
    arrow(
      arrows.dangling,
      "a11",
      90,
      200,
      0,
      100,
      binding(nodes.a, [0.5, 1]),
      null,
      null,
      "arrow",
    ),
    {
      ...baseElement(unrelated, "a12"),
      type: "ellipse",
      x: 700,
      y: 420,
      width: 90,
      height: 60,
      backgroundColor: "#fff4e6",
    },
  ];
};

export const mapElementsById = (
  elements: readonly ExcalidrawElement[],
): ElementByIdMap => new Map(elements.map((element) => [element.id, element]));

export const assertAtomicSceneBidirectionalBindings = (
  elements: readonly ExcalidrawElement[],
): void => {
  const elementsById = mapElementsById(elements);

  for (const element of elements) {
    if (element.type === "text" && element.containerId) {
      const container = elementsById.get(element.containerId);
      if (!container) {
        throw new Error(
          `Missing text container ${element.containerId} for ${element.id}`,
        );
      }
      if (
        !container.boundElements?.some(
          ({ id, type }) => id === element.id && type === "text",
        )
      ) {
        throw new Error(
          `Container ${container.id} does not reference text ${element.id}`,
        );
      }
    }

    if (element.type === "arrow") {
      for (const endpoint of [element.startBinding, element.endBinding]) {
        if (!endpoint) {
          continue;
        }
        const target = elementsById.get(endpoint.elementId);
        if (!target) {
          throw new Error(
            `Missing arrow binding target ${endpoint.elementId} for ${element.id}`,
          );
        }
        if (
          !target.boundElements?.some(
            ({ id, type }) => id === element.id && type === "arrow",
          )
        ) {
          throw new Error(
            `Binding target ${target.id} does not reference arrow ${element.id}`,
          );
        }
      }
    }
  }

  for (const element of elements) {
    for (const boundElement of element.boundElements ?? []) {
      const bound = elementsById.get(boundElement.id);
      if (!bound) {
        throw new Error(
          `Missing bound element ${boundElement.id} referenced by ${element.id}`,
        );
      }
      if (boundElement.type === "text") {
        if (bound.type !== "text" || bound.containerId !== element.id) {
          throw new Error(
            `Text ${bound.id} does not bind back to ${element.id}`,
          );
        }
      } else if (
        bound.type !== "arrow" ||
        (bound.startBinding?.elementId !== element.id &&
          bound.endBinding?.elementId !== element.id)
      ) {
        throw new Error(
          `Arrow ${bound.id} does not bind back to ${element.id}`,
        );
      }
    }
  }
};
