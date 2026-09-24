import { describe, expect, test } from "bun:test";

import { applyAtomicSceneEdit } from "../src/atomic-scene-edit";
import { positionNativeArrowLabel } from "../src/native-derived-geometry.js";
import { convertElementsForStorage } from "../src/server-element-conversion";

const reference = (element: any) => ({
  id: element.id,
  version: element.version,
  versionNonce: element.versionNonce,
});
const get = (elements: any[], id: string) =>
  elements.find((element) => element.id === id)!;
const orthogonal = (points: number[][]) =>
  points.every(
    (point, index) =>
      index === 0 ||
      point[0] === points[index - 1][0] ||
      point[1] === points[index - 1][1],
  );
const scene = () =>
  convertElementsForStorage([
    {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      label: { text: "A" },
    },
    { id: "b", type: "rectangle", x: 400, y: 160, width: 100, height: 80 },
    {
      id: "e",
      type: "arrow",
      x: 100,
      y: 40,
      width: 300,
      height: 160,
      points: [
        [0, 0],
        [300, 160],
      ],
      start: { id: "a" },
      end: { id: "b" },
      label: { text: "calls" },
    },
  ]);

function expectLabelOnRoute(elements: any[]) {
  const arrow = get(elements, "e");
  const label = get(elements, "e__label");
  const position = positionNativeArrowLabel(
    arrow,
    label,
    new Map(elements.map((element) => [element.id, element])),
  );
  expect(label.x).toBeCloseTo(position.x);
  expect(label.y).toBeCloseTo(position.y);
  expect(label.containerId).toBe(arrow.id);
  expect(arrow.boundElements).toContainEqual({ id: label.id, type: "text" });
}

describe("native Elbow editing regressions", () => {
  test("renaming a connected node preserves an orthogonal route, bindings and fixed segments", () => {
    const source = scene();
    const arrow = get(source, "e");
    arrow.fixedSegments = [
      { index: 2, start: arrow.points[1], end: arrow.points[2] },
    ];
    const snapshot = structuredClone(source);
    const result = applyAtomicSceneEdit(source, [
      {
        type: "set_node_label",
        node: reference(get(source, "a")),
        text: "Renamed",
      },
    ]);
    const updated = get(result.elements, "e");
    expect(updated.elbowed).toBe(true);
    expect(orthogonal(updated.points)).toBe(true);
    expect(updated.points.length).toBeGreaterThan(2);
    expect(updated.fixedSegments).toEqual(arrow.fixedSegments);
    expect(updated.startBinding).toEqual(arrow.startBinding);
    expect(updated.endBinding).toEqual(arrow.endBinding);
    expectLabelOnRoute(result.elements);
    expect(source).toEqual(snapshot);
  });

  test("rerouting after a node move refreshes the arrow label and audits it regardless of element order", () => {
    const source = scene();
    get(source, "a").y += 100;
    // A checkpoint can list bound text before its container.
    source.sort(
      (left: any, right: any) =>
        Number(right.type === "text") - Number(left.type === "text"),
    );
    const before = structuredClone(source);
    const result = applyAtomicSceneEdit(source, [
      {
        type: "set_node_label",
        node: reference(get(source, "a")),
        text: "Moved node",
      },
    ]);
    expect(orthogonal(get(result.elements, "e").points)).toBe(true);
    expectLabelOnRoute(result.elements);
    expect(result.affectedElementIds).toContain("e__label");
    expect(result.diff.derived).toContainEqual(
      expect.objectContaining({
        elementId: "e__label",
        field: "y",
        operationIndex: 0,
      }),
    );
    expect(source).toEqual(before);
  });

  test("renaming an edge positions its label on the route instead of the bounding box center", () => {
    const source = scene();
    const arrow = get(source, "e");
    arrow.points = [
      [0, 0],
      [300, 0],
      [300, 160],
    ];
    const result = applyAtomicSceneEdit(source, [
      { type: "set_edge_label", edge: reference(arrow), text: "Renamed edge" },
    ]);
    expectLabelOnRoute(result.elements);
    expect(get(result.elements, "e").points).toEqual(arrow.points);
  });

  test.each(["sharp", "round"] as const)(
    "setting %s preserves ordinary arrow waypoints and is idempotent",
    (arrowType) => {
      const source = convertElementsForStorage([
        {
          id: "e",
          type: "arrow",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          elbowed: false,
          roundness: null,
          points: [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
        },
      ]);
      const result = applyAtomicSceneEdit(source, [
        {
          type: "set_arrow_type",
          edge: reference(get(source, "e")),
          arrowType,
        },
      ]);
      expect(get(result.elements, "e").points).toEqual(get(source, "e").points);
      const repeated = applyAtomicSceneEdit(result.elements, [
        {
          type: "set_arrow_type",
          edge: reference(get(result.elements, "e")),
          arrowType,
        },
      ]);
      expect(repeated.affectedElementIds).toEqual([]);
      expect(repeated.elements).toEqual(result.elements);
    },
  );

  test("converting a rotated arrow preserves its world-space endpoints", () => {
    const source = convertElementsForStorage([
      {
        id: "e",
        type: "arrow",
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        angle: Math.PI / 2,
        elbowed: false,
        roughness: 0,
        roundness: null,
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]);
    const snapshot = structuredClone(source);
    const result = applyAtomicSceneEdit(source, [
      {
        type: "set_arrow_type",
        edge: reference(get(source, "e")),
        arrowType: "elbow",
      },
    ]);
    const arrow = get(result.elements, "e");
    const first = arrow.points[0];
    const last = arrow.points.at(-1);
    expect(arrow.x + first[0]).toBeCloseTo(50);
    expect(arrow.y + first[1]).toBeCloseTo(-50);
    expect(arrow.x + last[0]).toBeCloseTo(50);
    expect(arrow.y + last[1]).toBeCloseTo(50);
    expect(arrow.angle).toBe(0);
    expect(orthogonal(arrow.points)).toBe(true);
    expect(source).toEqual(snapshot);
  });
});
