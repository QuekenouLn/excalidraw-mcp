import { updateElbowArrowPoints } from "../../../packages/element/src/elbowArrow.ts";
import { computeBoundTextPosition } from "../../../packages/element/src/textElement.ts";

export const positionNativeArrowLabel = (arrow, label, elementsById) =>
  computeBoundTextPosition(arrow, label, elementsById);

export const routeNativeElbowArrow = (arrow, elementsById) => {
  const first = arrow.points[0];
  const last = arrow.points[arrow.points.length - 1];
  const start = [arrow.x + first[0], arrow.y + first[1]];
  const end = [arrow.x + last[0], arrow.y + last[1]];
  const prepared = {
    ...arrow,
    x: start[0],
    y: start[1],
    angle: 0,
    points: [
      [0, 0],
      [0, 0],
    ],
    fixedSegments: null,
    elbowed: true,
  };
  return {
    ...updateElbowArrowPoints(prepared, elementsById, {
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
      startBinding: arrow.startBinding ? { ...arrow.startBinding } : null,
      endBinding: arrow.endBinding ? { ...arrow.endBinding } : null,
      fixedSegments: null,
    }),
    angle: 0,
    fixedSegments: null,
  };
};

export const computeNativeBoundTextPosition = (
  container,
  textElement,
  _elementsById,
) => ({
  x: container.x + (container.width - textElement.width) / 2,
  y: container.y + (container.height - textElement.height) / 2,
});

export const refreshNativeBoundArrows = (elementsById, triggerIds) => {
  const arrows = new Set();
  for (const elementId of triggerIds) {
    const element = elementsById.get(elementId);
    for (const binding of element?.boundElements ?? []) {
      if (binding.type === "arrow") {
        arrows.add(binding.id);
      }
    }
  }
  for (const arrowId of arrows) {
    const arrow = elementsById.get(arrowId);
    if (!arrow || arrow.type !== "arrow" || !Array.isArray(arrow.points)) {
      continue;
    }
    const start = resolveEndpoint(elementsById, arrow.startBinding);
    const end = resolveEndpoint(elementsById, arrow.endBinding);
    if (!start || !end) {
      continue;
    }
    arrow.x = start[0];
    arrow.y = start[1];
    arrow.points = [
      [0, 0],
      [end[0] - start[0], end[1] - start[1]],
    ];
    arrow.width = Math.abs(end[0] - start[0]);
    arrow.height = Math.abs(end[1] - start[1]);
  }
};

const resolveEndpoint = (elementsById, binding) => {
  const element = binding?.elementId
    ? elementsById.get(binding.elementId)
    : null;
  if (!element) {
    return null;
  }
  const fixedPoint = binding.fixedPoint ?? [0.5, 0.5];
  return [
    element.x + element.width * fixedPoint[0],
    element.y + element.height * fixedPoint[1],
  ];
};
