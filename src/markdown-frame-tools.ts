import crypto from "node:crypto";

import { z } from "zod/v4";

import { createMarkdownFrameHtml } from "./markdown-frame.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CheckpointStore } from "./checkpoint-store.js";


const MAX_MARKDOWN_BYTES = 1024 * 1024;
const checkpointIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const frameIdSchema = z.string().min(1).max(128);

type MarkdownFrameData = {
  markdown: string;
  contentScale?: number;
  theme?: string;
  version?: number;
  [key: string]: unknown;
};

type MarkdownFrameElement = Record<string, any> & {
  id: string;
  type: "iframe";
  customData: Record<string, any> & { markdownFrame: MarkdownFrameData };
};

const isMarkdownFrame = (element: any): element is MarkdownFrameElement =>
  element?.type === "iframe" &&
  !element.isDeleted &&
  typeof element.id === "string" &&
  typeof element.customData?.markdownFrame?.markdown === "string";

const normalizeScale = (value: unknown) => {
  const scale = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(2, Math.max(0.5, Math.round(scale * 10) / 10));
};

const previewMarkdown = (markdown: string) =>
  markdown.replace(/\s+/g, " ").trim().slice(0, 200);

const toFrameDto = (element: MarkdownFrameElement, includeMarkdown = false) => {
  const data = element.customData.markdownFrame;
  return {
    id: element.id,
    x: Number(element.x) || 0,
    y: Number(element.y) || 0,
    width: Number(element.width) || 0,
    height: Number(element.height) || 0,
    preview: previewMarkdown(data.markdown),
    ...(includeMarkdown ? { markdown: data.markdown } : {}),
    contentScale: normalizeScale(data.contentScale),
    theme: typeof data.theme === "string" ? data.theme : "aurora",
    schemaVersion: Number.isInteger(data.version) ? data.version : 1,
    elementVersion: Number.isInteger(element.version) ? element.version : 1,
  };
};

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const randomInteger = () => crypto.randomInt(1, 2 ** 31 - 1);

export const createMarkdownFrameElement = (input: {
  markdown: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  contentScale?: number;
  index?: string;
}) => {
  if (new TextEncoder().encode(input.markdown).byteLength > MAX_MARKDOWN_BYTES) {
    throw new Error(`Markdown exceeds ${MAX_MARKDOWN_BYTES} byte limit`);
  }
  const contentScale = normalizeScale(input.contentScale);
  const id = `markdown_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  return {
    id,
    type: "iframe" as const,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 400,
    height: input.height ?? 240,
    angle: 0,
    strokeColor: "#c74ded",
    backgroundColor: "#23262e",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: input.index ?? "a0",
    roundness: null,
    seed: randomInteger(),
    version: 1,
    versionNonce: randomInteger(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    customData: {
      generationData: {
        status: "done",
        html: createMarkdownFrameHtml(input.markdown, contentScale),
      },
      markdownFrame: {
        markdown: input.markdown,
        contentScale,
        theme: "aurora",
        version: 1,
      },
    },
  } satisfies MarkdownFrameElement;
};

export const deleteMarkdownFrameElements = (
  elements: any[],
  frameId: string,
) =>
  elements
    .filter(
      (element) => element.id !== frameId && element.containerId !== frameId,
    )
    .map((element) => {
      const startWasBound = element.startBinding?.elementId === frameId;
      const endWasBound = element.endBinding?.elementId === frameId;
      const boundElements = Array.isArray(element.boundElements)
        ? element.boundElements.filter((binding: any) => binding.id !== frameId)
        : element.boundElements;
      const boundElementsChanged =
        Array.isArray(element.boundElements) &&
        boundElements.length !== element.boundElements.length;
      if (!startWasBound && !endWasBound && !boundElementsChanged) {return element;}
      return {
        ...element,
        ...(startWasBound ? { startBinding: null } : {}),
        ...(endWasBound ? { endBinding: null } : {}),
        ...(boundElementsChanged ? { boundElements: boundElements.length ? boundElements : null } : {}),
        version: (Number.isInteger(element.version) ? element.version : 1) + 1,
        versionNonce: randomInteger(),
        updated: Date.now(),
      };
    });

export const queryMarkdownFrames = (
  elements: any[],
  query?: string,
  limit = 20,
) => {
  const term = query?.trim().toLocaleLowerCase();
  const matches = elements.filter(
    (element) =>
      isMarkdownFrame(element) &&
      (!term ||
        element.customData.markdownFrame.markdown
          .toLocaleLowerCase()
          .includes(term)),
  );
  return {
    frames: matches.slice(0, limit).map((element) => toFrameDto(element)),
    total: matches.length,
  };
};

export const updateMarkdownFrameElement = (
  element: MarkdownFrameElement,
  input: {
    operation: "replace" | "append" | "find_replace";
    markdown?: string;
    find?: string;
    replace?: string;
    contentScale?: number;
  },
) => {
  const current = element.customData.markdownFrame;
  let markdown = current.markdown;
  if (input.operation === "replace") {
    if (input.markdown === undefined) {throw new Error("markdown is required for replace");}
    markdown = input.markdown;
  } else if (input.operation === "append") {
    if (input.markdown === undefined) {throw new Error("markdown is required for append");}
    markdown = `${markdown}${markdown.endsWith("\n") ? "" : "\n"}${input.markdown}`;
  } else {
    if (!input.find) {throw new Error("find is required for find_replace");}
    if (input.replace === undefined) {throw new Error("replace is required for find_replace");}
    const occurrences = markdown.split(input.find).length - 1;
    if (occurrences === 0) {throw new Error("find text was not found");}
    if (occurrences > 1) {throw new Error("find text is not unique");}
    markdown = markdown.replace(input.find, input.replace);
  }
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES) {
    throw new Error(`Markdown exceeds ${MAX_MARKDOWN_BYTES} byte limit`);
  }
  const contentScale = normalizeScale(input.contentScale ?? current.contentScale);
  return {
    ...element,
    customData: {
      ...element.customData,
      generationData: {
        ...element.customData.generationData,
        status: "done",
        html: createMarkdownFrameHtml(markdown, contentScale),
      },
      markdownFrame: {
        ...current,
        markdown,
        contentScale,
        theme: typeof current.theme === "string" ? current.theme : "aurora",
        version: Number.isInteger(current.version) ? current.version : 1,
      },
    },
    version: (Number.isInteger(element.version) ? element.version : 1) + 1,
    versionNonce: crypto.randomInt(1, 2 ** 31 - 1),
    updated: Date.now(),
  } as MarkdownFrameElement;
};

export function registerMarkdownFrameTools(
  server: McpServer,
  store: CheckpointStore,
): void {
  server.registerTool(
    "create_markdown_frame",
    {
      description: "Create a Markdown Frame in a new rollback-safe Excalidraw checkpoint. Optionally append it to an existing checkpoint.",
      inputSchema: {
        checkpointId: checkpointIdSchema.optional(),
        markdown: z.string(),
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        width: z.number().finite().positive().max(10000).default(400),
        height: z.number().finite().positive().max(10000).default(240),
        contentScale: z.number().min(0.5).max(2).default(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input): Promise<CallToolResult> => {
      const source = input.checkpointId
        ? await store.load(input.checkpointId)
        : null;
      if (input.checkpointId && !source) {
        return errorResult(`Checkpoint "${input.checkpointId}" not found.`);
      }
      let frame: MarkdownFrameElement;
      try {
        frame = createMarkdownFrameElement({
          ...input,
          index: `a${source?.elements.length ?? 0}`,
        });
      } catch (error) {
        return errorResult((error as Error).message);
      }
      const checkpointId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
      await store.save(checkpointId, {
        elements: [...(source?.elements ?? []), frame],
        remote: source?.remote,
      });
      const result = {
        ...(input.checkpointId
          ? { sourceCheckpointId: input.checkpointId }
          : {}),
        checkpointId,
        frame: toFrameDto(frame, true),
      };
      return {
        content: [{
          type: "text",
          text: `Markdown Frame "${frame.id}" created. New checkpoint id: "${checkpointId}". Restore this checkpoint to display it.`,
        }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "query_markdown_frames",
    {
      description: "List or search Markdown Frames in an Excalidraw checkpoint without returning generated HTML.",
      inputSchema: {
        checkpointId: checkpointIdSchema,
        query: z.string().max(500).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ checkpointId, query, limit }): Promise<CallToolResult> => {
      const checkpoint = await store.load(checkpointId);
      if (!checkpoint) {return errorResult(`Checkpoint "${checkpointId}" not found.`);}
      const result = { checkpointId, ...queryMarkdownFrames(checkpoint.elements, query, limit) };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_markdown_frame",
    {
      description: "Get the complete Markdown source and metadata for one Markdown Frame.",
      inputSchema: { checkpointId: checkpointIdSchema, frameId: frameIdSchema },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ checkpointId, frameId }): Promise<CallToolResult> => {
      const checkpoint = await store.load(checkpointId);
      if (!checkpoint) {return errorResult(`Checkpoint "${checkpointId}" not found.`);}
      const frame = checkpoint.elements.find(
        (element) => isMarkdownFrame(element) && element.id === frameId,
      );
      if (!frame) {return errorResult(`Markdown Frame "${frameId}" not found.`);}
      const result = { checkpointId, frame: toFrameDto(frame, true) };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "update_markdown_frame",
    {
      description: "Update one Markdown Frame with version checking and create a new rollback-safe checkpoint. Supports replace, append, and unique find/replace.",
      inputSchema: {
        checkpointId: checkpointIdSchema,
        frameId: frameIdSchema,
        expectedElementVersion: z.number().int().min(1),
        operation: z.enum(["replace", "append", "find_replace"]),
        markdown: z.string().optional(),
        find: z.string().optional(),
        replace: z.string().optional(),
        contentScale: z.number().min(0.5).max(2).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input): Promise<CallToolResult> => {
      const checkpoint = await store.load(input.checkpointId);
      if (!checkpoint) {return errorResult(`Checkpoint "${input.checkpointId}" not found.`);}
      const index = checkpoint.elements.findIndex(
        (element) => isMarkdownFrame(element) && element.id === input.frameId,
      );
      if (index < 0) {return errorResult(`Markdown Frame "${input.frameId}" not found.`);}
      const current = checkpoint.elements[index] as MarkdownFrameElement;
      const currentVersion = Number.isInteger(current.version) ? current.version : 1;
      if (currentVersion !== input.expectedElementVersion) {
        return errorResult(
          `Markdown Frame version conflict: expected ${input.expectedElementVersion}, current ${currentVersion}. Read the frame again before updating.`,
        );
      }
      let updated: MarkdownFrameElement;
      try {
        updated = updateMarkdownFrameElement(current, input);
      } catch (error) {
        return errorResult((error as Error).message);
      }
      const elements = [...checkpoint.elements];
      elements[index] = updated;
      const checkpointId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
      await store.save(checkpointId, { elements, remote: checkpoint.remote });
      const result = {
        sourceCheckpointId: input.checkpointId,
        checkpointId,
        frame: toFrameDto(updated, true),
      };
      return {
        content: [{
          type: "text",
          text: `Markdown Frame "${input.frameId}" updated. New checkpoint id: "${checkpointId}". Restore this checkpoint to display the change.`,
        }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "delete_markdown_frame",
    {
      description: "Delete one Markdown Frame with version checking and create a new rollback-safe checkpoint.",
      inputSchema: {
        checkpointId: checkpointIdSchema,
        frameId: frameIdSchema,
        expectedElementVersion: z.number().int().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input): Promise<CallToolResult> => {
      const checkpoint = await store.load(input.checkpointId);
      if (!checkpoint) {return errorResult(`Checkpoint "${input.checkpointId}" not found.`);}
      const current = checkpoint.elements.find(
        (element) => isMarkdownFrame(element) && element.id === input.frameId,
      ) as MarkdownFrameElement | undefined;
      if (!current) {return errorResult(`Markdown Frame "${input.frameId}" not found.`);}
      const currentVersion = Number.isInteger(current.version) ? current.version : 1;
      if (currentVersion !== input.expectedElementVersion) {
        return errorResult(
          `Markdown Frame version conflict: expected ${input.expectedElementVersion}, current ${currentVersion}. Read the frame again before deleting.`,
        );
      }
      const elements = deleteMarkdownFrameElements(
        checkpoint.elements,
        input.frameId,
      );
      const checkpointId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
      await store.save(checkpointId, { elements, remote: checkpoint.remote });
      const result = {
        sourceCheckpointId: input.checkpointId,
        checkpointId,
        deletedFrameId: input.frameId,
      };
      return {
        content: [{
          type: "text",
          text: `Markdown Frame "${input.frameId}" deleted. New checkpoint id: "${checkpointId}". Restore this checkpoint to display the change.`,
        }],
        structuredContent: result,
      };
    },
  );
}
