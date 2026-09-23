import { describe, expect, test } from "bun:test";

import {
  createMarkdownFrameElement,
  deleteMarkdownFrameElements,
  queryMarkdownFrames,
  updateMarkdownFrameElement,
} from "../src/markdown-frame-tools";

const markdownFrame = () => ({
  id: "markdown-1",
  type: "iframe" as const,
  x: 10,
  y: 20,
  width: 400,
  height: 240,
  version: 3,
  versionNonce: 10,
  updated: 1,
  customData: {
    unrelated: { keep: true },
    generationData: { status: "done", html: "old", keep: true },
    markdownFrame: {
      markdown: "# Architecture\n\nOld body",
      contentScale: 1,
      theme: "aurora",
      version: 1,
      keep: true,
    },
  },
});

describe("Markdown Frame MCP helpers", () => {
  test("creates a native sharp Markdown Frame with safe HTML", () => {
    const frame = createMarkdownFrameElement({
      markdown:
        "# Created\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))",
      x: 30,
      y: 40,
    });
    expect(frame).toMatchObject({
      type: "iframe",
      x: 30,
      y: 40,
      width: 400,
      height: 240,
      roundness: null,
      version: 1,
      isDeleted: false,
      strokeColor: "#c74ded",
      backgroundColor: "#23262e",
    });
    expect(frame.customData.generationData.html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(frame.customData.generationData.html).toContain('href="#"');
  });

  test("queries summaries without generated HTML", () => {
    const result = queryMarkdownFrames(
      [markdownFrame(), { id: "rect", type: "rectangle" }],
      "architecture",
    );
    expect(result.total).toBe(1);
    expect(result.frames[0]).toEqual({
      id: "markdown-1",
      x: 10,
      y: 20,
      width: 400,
      height: 240,
      preview: "# Architecture Old body",
      contentScale: 1,
      theme: "aurora",
      schemaVersion: 1,
      elementVersion: 3,
    });
    expect(JSON.stringify(result)).not.toContain("generationData");
  });

  test("replaces source and regenerates safe HTML", () => {
    const updated = updateMarkdownFrameElement(markdownFrame(), {
      operation: "replace",
      markdown:
        "# Updated\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))",
      contentScale: 1.2,
    });
    expect(updated.version).toBe(4);
    expect(updated.customData.unrelated).toEqual({ keep: true });
    expect(updated.customData.markdownFrame.keep).toBe(true);
    expect(updated.customData.markdownFrame.contentScale).toBe(1.2);
    expect(updated.customData.generationData.keep).toBe(true);
    expect(updated.customData.generationData.html).toContain(
      "<h1>Updated</h1>",
    );
    expect(updated.customData.generationData.html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(updated.customData.generationData.html).toContain('href="#"');
    expect(updated.customData.generationData.html).not.toContain("<script>");
  });

  test("appends and performs unique find/replace", () => {
    const appended = updateMarkdownFrameElement(markdownFrame(), {
      operation: "append",
      markdown: "## New section",
    });
    expect(appended.customData.markdownFrame.markdown).toEndWith(
      "## New section",
    );

    const replaced = updateMarkdownFrameElement(markdownFrame(), {
      operation: "find_replace",
      find: "Old body",
      replace: "New body",
    });
    expect(replaced.customData.markdownFrame.markdown).toContain("New body");
  });

  test("rejects ambiguous find/replace", () => {
    const element = markdownFrame();
    element.customData.markdownFrame.markdown = "same same";
    expect(() =>
      updateMarkdownFrameElement(element, {
        operation: "find_replace",
        find: "same",
        replace: "new",
      }),
    ).toThrow("find text is not unique");
  });

  test("deletes the frame and clears arrow bindings without mutating input", () => {
    const frame = markdownFrame();
    const arrow = {
      id: "arrow-1",
      type: "arrow",
      version: 2,
      versionNonce: 3,
      startBinding: { elementId: frame.id },
      endBinding: null,
    };
    const elements = [frame, arrow, { id: "other", type: "rectangle" }];
    const result = deleteMarkdownFrameElements(elements, frame.id);
    expect(result.map((element) => element.id)).toEqual(["arrow-1", "other"]);
    expect(result[0].startBinding).toBeNull();
    expect(result[0].version).toBe(3);
    expect(arrow.startBinding).toEqual({ elementId: frame.id });
    expect(elements).toHaveLength(3);
  });
});
