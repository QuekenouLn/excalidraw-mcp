import { isDeepStrictEqual } from "node:util";

import {
  applyAtomicSceneEdit,
  AtomicSceneEditError,
} from "./atomic-scene-edit.js";
import {
  convertElementsForStorage,
  deriveBoundTextDimensions,
} from "./server-element-conversion.js";
import {
  createNativeElementIndexBetween,
  computeNativeBoundTextPosition,
  refreshNativeBoundArrows,
} from "./native-derived-geometry.js";

import type {
  AtomicSceneElement,
  AtomicSceneEditResult,
} from "./atomic-scene-edit.js";

export type SingleElementEdit = {
  target: { id: string; version: number; versionNonce: number };
  changes?: Record<string, unknown>;
  text?: string;
  replaceWithCard?: {
    text: string;
    styleFrom?: { id: string; version: number; versionNonce: number };
  };
  allowedElementIds?: string[];
};

const STYLE_FIELDS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
];
const GEOMETRY_FIELDS = new Set(["x", "y", "width", "height", "angle"]);
const PATCH_FIELDS = new Set([
  ...STYLE_FIELDS,
  ...GEOMETRY_FIELDS,
  "startArrowhead",
  "endArrowhead",
]);

/** Only the target and its own bound text may change unless explicitly allowed. */
export function editSingleSceneElement(
  source: readonly AtomicSceneElement[],
  edit: SingleElementEdit,
): AtomicSceneEditResult {
  const original = new Map(source.map((element) => [element.id, element]));
  const requireElement = (expected: SingleElementEdit["target"]) => {
    const element = original.get(expected.id);
    if (!element || element.isDeleted) {
      throw new AtomicSceneEditError(
        "ELEMENT_NOT_FOUND",
        `Element "${expected.id}" not found.`,
      );
    }
    if (
      element.version !== expected.version ||
      element.versionNonce !== expected.versionNonce
    ) {
      throw new AtomicSceneEditError(
        "VERSION_CONFLICT",
        `Element "${expected.id}" changed. Select it again.`,
      );
    }
    return element;
  };
  const target = requireElement(edit.target);
  if (edit.replaceWithCard && (edit.changes || edit.text !== undefined)) {
    throw new AtomicSceneEditError(
      "INVALID_ARGUMENT",
      "Card replacement cannot be combined with a patch or label edit.",
    );
  }
  if (
    !edit.replaceWithCard &&
    edit.text === undefined &&
    !Object.keys(edit.changes ?? {}).length
  ) {
    throw new AtomicSceneEditError(
      "INVALID_ARGUMENT",
      "Provide changes, text, or replaceWithCard.",
    );
  }
  const allowed = new Set([target.id, ...(edit.allowedElementIds ?? [])]);
  const ownText = source.filter(
    (element) =>
      element.type === "text" &&
      element.containerId === target.id &&
      !element.isDeleted,
  );
  ownText.forEach((element) => allowed.add(element.id));
  let elements = structuredClone(source) as AtomicSceneElement[];
  if (edit.replaceWithCard) {
    if (
      !target.customData?.markdownFrame ||
      target.locked ||
      ownText.length ||
      (target.boundElements ?? []).length ||
      source.some(
        (element) =>
          element.startBinding?.elementId === target.id ||
          element.endBinding?.elementId === target.id,
      )
    ) {
      throw new AtomicSceneEditError(
        "INVALID_ELEMENT_TYPE",
        "Card replacement requires an unlocked, unbound Markdown Frame.",
      );
    }
    const template = edit.replaceWithCard.styleFrom
      ? requireElement(edit.replaceWithCard.styleFrom)
      : null;
    if (template && template.type !== "rectangle") {
      throw new AtomicSceneEditError(
        "INVALID_ELEMENT_TYPE",
        "styleFrom must be a rectangle card.",
      );
    }
    const templateText =
      template &&
      source.find(
        (element) =>
          element.type === "text" &&
          element.containerId === template.id &&
          !element.isDeleted,
      );
    const labelId = `${target.id}__label`;
    if (original.has(labelId)) {
      throw new AtomicSceneEditError(
        "DUPLICATE_ELEMENT_ID",
        `Element "${labelId}" already exists.`,
      );
    }
    const card = {
      type: "rectangle",
      id: target.id,
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
      angle: target.angle,
      groupIds: target.groupIds,
      frameId: target.frameId,
      strokeColor: "#15803d",
      backgroundColor: "#bbf7d0",
      fillStyle: "solid",
      ...Object.fromEntries(
        STYLE_FIELDS.filter(
          (field) => template && template[field] !== undefined,
        ).map((field) => [field, template![field]]),
      ),
      label: {
        text: edit.replaceWithCard.text,
        fontSize: templateText?.fontSize ?? 20,
        fontFamily: templateText?.fontFamily ?? 11,
      },
    };
    const converted = convertElementsForStorage([card]);
    const replacement = converted.find((element) => element.id === target.id);
    if (
      replacement.width !== target.width ||
      replacement.height !== target.height
    ) {
      throw new AtomicSceneEditError(
        "INVALID_ARGUMENT",
        "Text does not fit the original card dimensions. Shorten the text or edit the frame size first.",
      );
    }
    replacement.index = target.index;
    const nextIndex =
      source
        .map((element) => element.index)
        .filter(
          (index): index is string =>
            typeof index === "string" && index > target.index,
        )
        .sort()[0] ?? null;
    for (const element of converted) {
      if (element.id !== target.id) {
        element.index = createNativeElementIndexBetween(
          target.index ?? null,
          nextIndex,
        );
      }
    }
    elements = elements.flatMap((element) =>
      element.id === target.id ? converted : [element],
    );
    allowed.add(labelId);
  } else {
    if (
      target.locked ||
      !["rectangle", "diamond", "ellipse", "arrow"].includes(target.type)
    ) {
      throw new AtomicSceneEditError(
        "INVALID_ELEMENT_TYPE",
        "Select an unlocked node or arrow.",
      );
    }
    if (edit.text !== undefined) {
      elements = applyAtomicSceneEdit(elements, [
        {
          type: target.type === "arrow" ? "set_edge_label" : "set_node_label",
          target: edit.target,
          text: edit.text,
        },
      ]).elements;
    }
    const working = elements.find((element) => element.id === target.id)!;
    for (const [field, value] of Object.entries(edit.changes ?? {})) {
      if (
        !PATCH_FIELDS.has(field) ||
        ((field === "startArrowhead" || field === "endArrowhead") &&
          target.type !== "arrow") ||
        (target.type === "arrow" && GEOMETRY_FIELDS.has(field))
      ) {
        throw new AtomicSceneEditError(
          "INVALID_ARGUMENT",
          `Unsupported field "${field}" for ${target.type}.`,
        );
      }
      working[field] = structuredClone(value);
    }
    const byId = new Map<string, AtomicSceneElement>(
      elements
        .filter((element) => typeof element.id === "string")
        .map((element) => [element.id!, element]),
    );
    if (
      Object.keys(edit.changes ?? {}).some(
        (field) =>
          GEOMETRY_FIELDS.has(field) &&
          !isDeepStrictEqual(target[field], working[field]),
      )
    ) {
      for (const text of ownText) {
        const label = byId.get(text.id!)!;
        Object.assign(label, deriveBoundTextDimensions(label, working));
        Object.assign(
          label,
          computeNativeBoundTextPosition(working, label, byId),
        );
      }
      refreshNativeBoundArrows(byId, [edit.target.id]);
    }
  }
  const diff: AtomicSceneEditResult["diff"] = { direct: [], derived: [] };
  const affectedElementIds: string[] = [];
  for (const element of elements) {
    const before = original.get(element.id);
    if (isDeepStrictEqual(before, element)) {
      continue;
    }
    if (!allowed.has(element.id)) {
      throw new AtomicSceneEditError(
        "INVARIANT_VIOLATION",
        `Edit would change unapproved element "${element.id}".`,
        {
          details: {
            unexpectedElementId: element.id,
            allowedElementIds: [...allowed],
          },
        },
      );
    }
    affectedElementIds.push(element.id!);
    if (before) {
      element.version = before.version + 1;
      element.versionNonce = ((before.versionNonce ?? 0) + 1) | 0;
      element.updated = Math.max(Date.now(), (before.updated ?? 0) + 1);
    }
    const entries = element.id === target.id ? diff.direct : diff.derived;
    for (const field of new Set([
      ...Object.keys(before ?? {}),
      ...Object.keys(element),
    ])) {
      if (!isDeepStrictEqual(before?.[field], element[field])) {
        entries.push({
          operationIndex: 0,
          elementId: element.id!,
          field,
          before: before?.[field] ?? null,
          after: element[field] ?? null,
        });
      }
    }
  }
  return { elements, affectedElementIds, diff };
}
