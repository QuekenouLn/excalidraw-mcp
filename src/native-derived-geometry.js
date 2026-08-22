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
    if (!start || !end) continue;
    arrow.x = start[0];
    arrow.y = start[1];
    arrow.points = [[0, 0], [end[0] - start[0], end[1] - start[1]]];
    arrow.width = Math.abs(end[0] - start[0]);
    arrow.height = Math.abs(end[1] - start[1]);
  }
};

const resolveEndpoint = (elementsById, binding) => {
  const element = binding?.elementId
    ? elementsById.get(binding.elementId)
    : null;
  if (!element) return null;
  const fixedPoint = binding.fixedPoint ?? [0.5, 0.5];
  return [
    element.x + element.width * fixedPoint[0],
    element.y + element.height * fixedPoint[1],
  ];
};
