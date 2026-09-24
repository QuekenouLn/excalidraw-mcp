export function positionNativeArrowLabel(
  arrow: Record<string, any>,
  label: Record<string, any>,
  elementsById: Map<string, Record<string, any>>,
): { x: number; y: number };

export function routeNativeElbowArrow(
  arrow: Record<string, any>,
  elementsById: Map<string, Record<string, any>>,
): Record<string, any>;

export function computeNativeBoundTextPosition(
  container: Record<string, any>,
  textElement: Record<string, any>,
  elementsById: Map<string, Record<string, any>>,
): { x: number; y: number };

export function refreshNativeBoundArrows(
  elementsById: Map<string, Record<string, any>>,
  triggerIds: Iterable<string>,
): void;
