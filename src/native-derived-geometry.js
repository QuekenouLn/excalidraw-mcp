import { updateElbowArrowPoints } from "../../../packages/element/src/elbowArrow.ts";
import { LinearElementEditor } from "../../../packages/element/src/linearElementEditor.ts";
import { computeBoundTextPosition } from "../../../packages/element/src/textElement.ts";

export const positionNativeArrowLabel = (arrow, label, elementsById) =>
  computeBoundTextPosition(arrow, label, elementsById);

export const routeNativeElbowArrow = (arrow, elementsById) => {
  const start = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    0,
    elementsById,
  );
  const end = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    arrow,
    -1,
    elementsById,
  );
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
  elementsById,
) =>
  container.type === "arrow"
    ? positionNativeArrowLabel(container, textElement, elementsById)
    : {
        x: container.x + (container.width - textElement.width) / 2,
        y: container.y + (container.height - textElement.height) / 2,
      };

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
    if (arrow.elbowed) {
      // Refresh the existing route without discarding user-fixed segments.
      Object.assign(
        arrow,
        updateElbowArrowPoints(arrow, elementsById, {
          startBinding: arrow.startBinding ? { ...arrow.startBinding } : null,
          endBinding: arrow.endBinding ? { ...arrow.endBinding } : null,
        }),
      );
    } else {
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
    for (const binding of arrow.boundElements ?? []) {
      const label = elementsById.get(binding.id);
      if (binding.type === "text" && label?.containerId === arrow.id) {
        Object.assign(
          label,
          positionNativeArrowLabel(arrow, label, elementsById),
        );
      }
    }
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
