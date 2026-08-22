export function computeNativeBoundTextPosition(
  container: Record<string, any>,
  textElement: Record<string, any>,
  elementsById: Map<string, Record<string, any>>,
): { x: number; y: number };

export function refreshNativeBoundArrows(
  elementsById: Map<string, Record<string, any>>,
  triggerIds: Iterable<string>,
): void;
