import { describe, expect, test } from "bun:test";

import {
  applyMcpStyleDefaults,
  applyMcpTextAlignment,
} from "../src/style-defaults";

describe("MCP style defaults", () => {
  test("applies Maple, thin, and type-aware soft edges", () => {
    expect(applyMcpStyleDefaults({ type: "rectangle" })).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 3, value: 12 },
    });
    expect(applyMcpStyleDefaults({ type: "diamond" })).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 2, value: 0.1 },
    });
    expect(applyMcpStyleDefaults({ type: "arrow" })).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 2, value: 0.1 },
    });
    expect(applyMcpStyleDefaults({ type: "text" }).fontFamily).toBe(11);
    expect(
      applyMcpStyleDefaults({ type: "rectangle", label: { text: "Label" } })
        .label.fontFamily,
    ).toBe(11);
  });

  test("keeps Markdown-style iframes sharp when explicitly requested", () => {
    expect(
      applyMcpStyleDefaults({ type: "iframe", roundness: null }).roundness,
    ).toBeNull();
  });

  test("preserves every explicit override", () => {
    const input = {
      type: "rectangle",
      strokeWidth: 4,
      roundness: null,
      label: { text: "Label", fontFamily: 5 },
    };
    expect(applyMcpStyleDefaults(input)).toEqual(input);
  });

  test("does not rewrite complete native elements", () => {
    const native = {
      id: "native",
      type: "text",
      x: 1,
      y: 2,
      width: 30,
      height: 20,
      text: "Existing",
      fontSize: 20,
      fontFamily: 5,
      lineHeight: 1.25,
      version: 4,
      versionNonce: 5,
    };
    expect(applyMcpStyleDefaults(native)).toBe(native);
  });

  test("forces new text and labels to horizontal center", () => {
    const text = {
      type: "text",
      textAlign: "right",
      verticalAlign: "bottom",
    };
    const shape = {
      type: "rectangle",
      label: {
        text: "Label",
        textAlign: "left",
        verticalAlign: "top",
      },
    };

    expect(applyMcpTextAlignment(text)).toEqual({
      ...text,
      textAlign: "center",
    });
    expect(applyMcpTextAlignment(shape)).toEqual({
      ...shape,
      label: {
        ...shape.label,
        textAlign: "center",
      },
    });
    expect(text.textAlign).toBe("right");
    expect(shape.label.textAlign).toBe("left");
  });
});
