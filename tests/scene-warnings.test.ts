import { describe, expect, test } from "bun:test";

import {
  collectSceneWarnings,
  formatWarningCounts,
} from "../src/scene-warnings";

const overlappingRectangles = () => [
  {
    id: "left",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 80,
  },
  {
    id: "right",
    type: "rectangle",
    x: 120,
    y: 20,
    width: 200,
    height: 80,
  },
];

const rectangleOverlappingMarkdownFrame = () => [
  {
    id: "card",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 180,
    height: 100,
  },
  {
    id: "markdown_note",
    type: "iframe",
    x: 40,
    y: 40,
    width: 400,
    height: 240,
    customData: {
      markdownFrame: { markdown: "# Note", version: 1 },
    },
  },
];

const unboundArrowScene = () => [
  {
    id: "source",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 160,
    height: 80,
  },
  {
    id: "target",
    type: "rectangle",
    x: 400,
    y: 0,
    width: 160,
    height: 80,
  },
  {
    id: "free",
    type: "arrow",
    x: 160,
    y: 40,
    width: 240,
    height: 0,
    points: [
      [0, 0],
      [240, 0],
    ],
    startBinding: null,
    endBinding: null,
  },
];

const overflowingBoundLabel = () => [
  {
    id: "narrow",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 50,
    height: 80,
  },
  {
    id: "narrow__label",
    type: "text",
    x: 0,
    y: 20,
    width: 240,
    height: 24,
    containerId: "narrow",
    text: "MMMMMMMMMMMMMMMMMMMM",
    originalText: "MMMMMMMMMMMMMMMMMMMM",
    fontSize: 20,
    fontFamily: 11,
    lineHeight: 1.2,
  },
];

const cleanLabeledTwoBoxScene = () => [
  {
    id: "source",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    boundElements: [
      { id: "source__label", type: "text" },
      { id: "edge", type: "arrow" },
    ],
  },
  {
    id: "source__label",
    type: "text",
    x: 80,
    y: 28,
    width: 40,
    height: 24,
    containerId: "source",
    text: "A",
    originalText: "A",
    fontSize: 20,
    fontFamily: 11,
    lineHeight: 1.2,
  },
  {
    id: "target",
    type: "rectangle",
    x: 400,
    y: 0,
    width: 200,
    height: 80,
    boundElements: [
      { id: "target__label", type: "text" },
      { id: "edge", type: "arrow" },
    ],
  },
  {
    id: "target__label",
    type: "text",
    x: 480,
    y: 28,
    width: 40,
    height: 24,
    containerId: "target",
    text: "B",
    originalText: "B",
    fontSize: 20,
    fontFamily: 11,
    lineHeight: 1.2,
  },
  {
    id: "edge",
    type: "arrow",
    x: 200,
    y: 40,
    width: 200,
    height: 0,
    points: [
      [0, 0],
      [200, 0],
    ],
    startBinding: { elementId: "source", fixedPoint: [1, 0.5] },
    endBinding: { elementId: "target", fixedPoint: [0, 0.5] },
  },
];

describe("collectSceneWarnings", () => {
  test("reports axis-aligned overlap between live rectangles", () => {
    const warnings = collectSceneWarnings(overlappingRectangles());

    expect(warnings.some((warning) => warning.type === "overlap")).toBe(true);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "overlap",
          a: "left",
          b: "right",
        }),
      ]),
    );
    const overlap = warnings.find((warning) => warning.type === "overlap");
    expect(overlap && overlap.type === "overlap" ? overlap.deficit : 0).toBeGreaterThan(
      0,
    );
  });

  test("reports a rectangle overlapping a Markdown Frame", () => {
    const warnings = collectSceneWarnings(rectangleOverlappingMarkdownFrame());

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "overlap",
          a: "card",
          b: "markdown_note",
        }),
      ]),
    );
  });

  test("reports arrows missing a start or end binding", () => {
    const warnings = collectSceneWarnings(unboundArrowScene());

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "unbound-arrow",
          id: "free",
          missing: ["start", "end"],
        }),
      ]),
    );
  });

  test("reports bound labels whose required width exceeds the container", () => {
    const warnings = collectSceneWarnings(overflowingBoundLabel());
    const overflow = warnings.find(
      (warning) => warning.type === "bound-text-overflow",
    );

    expect(overflow).toMatchObject({
      type: "bound-text-overflow",
      textId: "narrow__label",
      containerId: "narrow",
    });
    expect(
      overflow && overflow.type === "bound-text-overflow"
        ? overflow.deficit
        : 0,
    ).toBeGreaterThan(0);
  });

  test("returns no warnings for a clean labeled two-box scene with both bindings", () => {
    expect(collectSceneWarnings(cleanLabeledTwoBoxScene())).toEqual([]);
    expect(formatWarningCounts([])).toBe("No warnings.");
  });

  test("ignores deleted overlapping containers", () => {
    expect(
      collectSceneWarnings([
        { id: "live", type: "rectangle", x: 0, y: 0, width: 100, height: 80 },
        {
          id: "gone",
          type: "rectangle",
          x: 20,
          y: 0,
          width: 100,
          height: 80,
          isDeleted: true,
        },
      ]),
    ).toEqual([]);
  });
});
