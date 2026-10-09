import crypto from "node:crypto";
import { z } from "zod/v4";
import { computeCheckpointRevision } from "./checkpoint-store.js";
import { editSingleSceneElement } from "./single-element-edit.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CheckpointStore } from "./checkpoint-store.js";

const expectation = z.object({
  id: z.string().min(1).max(128),
  version: z.number().int().min(1),
  versionNonce: z.number().int(),
});
const arrowhead = z
  .enum([
    "arrow",
    "bar",
    "dot",
    "triangle",
    "triangle_outline",
    "circle",
    "circle_outline",
    "diamond",
    "diamond_outline",
    "crowfoot_one",
    "crowfoot_many",
    "crowfoot_one_or_many",
  ])
  .nullable();

export function registerSingleElementTool(
  server: McpServer,
  store: CheckpointStore,
  ensureFontMetrics: () => Promise<void>,
) {
  server.registerTool(
    "edit_scene_element",
    {
      description:
        "Edit one node's position, dimensions, style or label; edit one arrow's style or arrowheads; or replace one Markdown Frame with a native card. Only the target and its bound text may change by default. Any other affected element aborts the transaction unless explicitly listed in allowedElementIds. Returns only affected IDs and a field diff, never the full scene.",
      inputSchema: {
        checkpointId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
        target: expectation,
        changes: z
          .object({
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
            width: z.number().positive().optional(),
            height: z.number().positive().optional(),
            angle: z.number().finite().optional(),
            strokeColor: z.string().max(64).optional(),
            backgroundColor: z.string().max(64).optional(),
            fillStyle: z
              .enum(["hachure", "cross-hatch", "solid", "zigzag"])
              .optional(),
            strokeWidth: z.number().min(0).max(100).optional(),
            strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
            roughness: z.number().min(0).max(10).optional(),
            opacity: z.number().min(0).max(100).optional(),
            roundness: z
              .object({
                type: z.union([z.literal(2), z.literal(3)]),
                value: z.number().optional(),
              })
              .nullable()
              .optional(),
            startArrowhead: arrowhead.optional(),
            endArrowhead: arrowhead.optional(),
          })
          .strict()
          .optional(),
        text: z.string().max(10000).optional(),
        replaceWithCard: z
          .object({
            text: z.string().min(1).max(10000),
            styleFrom: expectation.optional(),
          })
          .optional(),
        allowedElementIds: z
          .array(z.string().min(1).max(128))
          .max(100)
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input) => {
      try {
        const source = await store.load(input.checkpointId);
        if (!source) {
          throw Object.assign(new Error("Checkpoint not found."), {
            code: "CHECKPOINT_NOT_FOUND",
          });
        }
        const sourceRevision = computeCheckpointRevision(source);
        if (sourceRevision !== input.expectedRevision) {
          throw Object.assign(
            new Error("Scene revision conflict. Select the target again."),
            { code: "REVISION_CONFLICT" },
          );
        }
        await ensureFontMetrics();
        const result = editSingleSceneElement(source.elements, input);
        const checkpointId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
        const checkpoint = await store.saveDerived({
          sourceId: input.checkpointId,
          expectedSourceRevision: input.expectedRevision,
          targetId: checkpointId,
          data: { elements: result.elements, remote: source.remote },
        });
        const structuredContent = {
          sourceCheckpointId: input.checkpointId,
          checkpointId,
          revision: computeCheckpointRevision(checkpoint),
          affectedElementIds: result.affectedElementIds,
          diff: result.diff,
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(structuredContent) },
          ],
          structuredContent,
        };
      } catch (error) {
        const failure = error as Error & { code?: string; details?: unknown };
        const structuredContent = {
          error: {
            code: failure.code ?? "SINGLE_ELEMENT_EDIT_FAILED",
            message: failure.message,
            details: failure.details,
          },
        };
        return {
          isError: true,
          content: [
            { type: "text" as const, text: JSON.stringify(structuredContent) },
          ],
          structuredContent,
        };
      }
    },
  );
}
