import crypto from "node:crypto";

import { z } from "zod/v4";

import {
  CheckpointStoreError,
  computeCheckpointRevision,
} from "./checkpoint-store.js";

import {
  SceneQueryError,
  querySceneGraph,
  selectSceneElements,
} from "./scene-query.js";
import {
  AtomicSceneEditError,
  applyAtomicSceneEdit,
} from "./atomic-scene-edit.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CheckpointData, CheckpointStore } from "./checkpoint-store.js";

const checkpointIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const elementIdSchema = z.string().min(1).max(128);
const elementTypeSchema = z.string().min(1).max(64);
const elementPreconditionSchema = z.object({
  id: elementIdSchema,
  version: z.number().int().min(1),
  versionNonce: z.number().int(),
});

const arrowheadSchema = z.enum(["arrow", "bar", "dot", "triangle"]).nullable();

const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_edge"),
    edgeId: elementIdSchema,
    start: elementPreconditionSchema,
    end: elementPreconditionSchema,
    startArrowhead: arrowheadSchema.optional(),
    endArrowhead: arrowheadSchema.optional(),
    arrowType: z.enum(["sharp", "round", "elbow"]).default("elbow"),
  }),
  z.object({
    type: z.literal("set_arrow_type"),
    edge: elementPreconditionSchema,
    arrowType: z.enum(["sharp", "round", "elbow"]),
  }),
  z.object({
    type: z.literal("set_edge_label"),
    edge: elementPreconditionSchema,
    text: z.string().max(10000),
  }),
  z.object({
    type: z.literal("set_node_label"),
    node: elementPreconditionSchema,
    text: z.string().max(10000),
  }),
]);

type StructuredError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    checkpointId?: string;
    currentRevision?: string;
  };
};

export const createSceneRevision = (checkpoint: CheckpointData): string =>
  computeCheckpointRevision(checkpoint);

const createCheckpointId = (): string =>
  crypto.randomUUID().replace(/-/g, "").slice(0, 18);

const successResult = (
  structuredContent: Record<string, unknown>,
): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  structuredContent,
});

const errorResult = (
  code: string,
  message: string,
  context: Omit<StructuredError["error"], "code" | "message"> = {},
): CallToolResult => {
  const structuredContent: StructuredError = {
    error: { code, message, ...context },
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
};

const errorCode = (error: unknown, fallback: string): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return fallback;
};

const errorDetails = (error: unknown): unknown => {
  if (typeof error === "object" && error !== null && "details" in error) {
    return error.details;
  }
  return undefined;
};

const atomicErrorDetails = (error: unknown): unknown => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const details = errorDetails(error);
  const result: Record<string, unknown> =
    typeof details === "object" && details !== null && !Array.isArray(details)
      ? { ...(details as Record<string, unknown>) }
      : details === undefined
      ? {}
      : { cause: details };
  if ("operationIndex" in error && typeof error.operationIndex === "number") {
    result.operationIndex = error.operationIndex;
  }
  return result;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isSceneQueryError = (error: unknown): boolean =>
  error instanceof SceneQueryError ||
  (typeof error === "object" && error !== null && "code" in error);

const isAtomicSceneEditError = (error: unknown): boolean =>
  error instanceof AtomicSceneEditError ||
  (typeof error === "object" && error !== null && "code" in error);

const isCheckpointStoreError = (error: unknown): boolean =>
  error instanceof CheckpointStoreError;

const toAtomicOperations = (operations: z.infer<typeof operationSchema>[]) =>
  operations.map((operation) => {
    if (operation.type === "add_edge") {
      return {
        type: operation.type,
        edgeId: operation.edgeId,
        start: operation.start,
        end: operation.end,
        edge: {
          ...(operation.startArrowhead !== undefined
            ? { startArrowhead: operation.startArrowhead }
            : {}),
          ...(operation.endArrowhead !== undefined
            ? { endArrowhead: operation.endArrowhead }
            : {}),
          elbowed: operation.arrowType === "elbow",
          roundness: operation.arrowType === "round" ? { type: 2 } : null,
        },
      };
    }
    if (operation.type === "set_arrow_type") {
      return operation;
    }
    return {
      type: operation.type,
      target:
        operation.type === "set_edge_label" ? operation.edge : operation.node,
      text: operation.text,
    };
  });

export function registerAtomicTools(
  server: McpServer,
  store: CheckpointStore,
  ensureFontMetrics: () => Promise<void> = async () => {},
): void {
  server.registerTool(
    "select_scene_elements",
    {
      description:
        "Precisely select ordinary Excalidraw elements from an immutable checkpoint by id, type, or bound text. Returns versions and binding metadata for safe follow-up edits.",
      inputSchema: {
        checkpointId: checkpointIdSchema,
        revision: revisionSchema.optional(),
        id: elementIdSchema.optional(),
        ids: z.array(elementIdSchema).max(100).optional(),
        types: z.array(elementTypeSchema).max(32).optional(),
        text: z.string().max(1000).optional(),
        textMatch: z.enum(["exact", "contains"]).default("exact"),
        caseSensitive: z.boolean().default(false),
        includeDeleted: z.boolean().default(false),
        includeBoundTextElements: z.boolean().default(false),
        requireUnique: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input): Promise<CallToolResult> => {
      let checkpoint;
      try {
        checkpoint = await store.load(input.checkpointId);
      } catch (error) {
        return errorResult("CHECKPOINT_LOAD_FAILED", errorMessage(error), {
          checkpointId: input.checkpointId,
        });
      }
      if (!checkpoint) {
        return errorResult(
          "CHECKPOINT_NOT_FOUND",
          `Checkpoint "${input.checkpointId}" not found.`,
          { checkpointId: input.checkpointId },
        );
      }

      const revision = createSceneRevision(checkpoint);
      if (input.revision && input.revision !== revision) {
        return errorResult(
          "REVISION_CONFLICT",
          `Scene revision conflict: expected ${input.revision}, current ${revision}.`,
          { checkpointId: input.checkpointId, currentRevision: revision },
        );
      }

      try {
        const selection = selectSceneElements(checkpoint.elements, {
          id: input.id,
          ids: input.ids,
          types: input.types,
          text: input.text,
          textMatch: input.textMatch,
          caseSensitive: input.caseSensitive,
          includeDeleted: input.includeDeleted,
          includeBoundTextElements: input.includeBoundTextElements,
          limit: input.limit,
        });
        if ((input.id || input.requireUnique) && selection.total === 0) {
          throw new SceneQueryError(
            "ELEMENT_NOT_FOUND",
            "No scene element matched the selector.",
            {
              id: input.id,
              ids: input.ids,
              text: input.text,
              types: input.types,
            },
          );
        }
        if ((input.id || input.requireUnique) && selection.total > 1) {
          throw new SceneQueryError(
            "ELEMENT_AMBIGUOUS",
            `The selector matched ${selection.total} scene elements.`,
            { elementIds: selection.elements.map((element) => element.id) },
          );
        }
        return successResult({
          checkpointId: input.checkpointId,
          revision,
          ...selection,
        });
      } catch (error) {
        return errorResult(
          errorCode(error, "SCENE_QUERY_FAILED"),
          errorMessage(error),
          {
            checkpointId: input.checkpointId,
            currentRevision: revision,
            ...(isSceneQueryError(error)
              ? { details: errorDetails(error) }
              : {}),
          },
        );
      }
    },
  );

  server.registerTool(
    "query_scene_graph",
    {
      description:
        "Project an Excalidraw checkpoint into nodes and edges, including bound, free, and broken endpoints plus directed, reverse, bidirectional, and undirected arrow semantics.",
      inputSchema: {
        checkpointId: checkpointIdSchema,
        revision: revisionSchema.optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input): Promise<CallToolResult> => {
      let checkpoint;
      try {
        checkpoint = await store.load(input.checkpointId);
      } catch (error) {
        return errorResult("CHECKPOINT_LOAD_FAILED", errorMessage(error), {
          checkpointId: input.checkpointId,
        });
      }
      if (!checkpoint) {
        return errorResult(
          "CHECKPOINT_NOT_FOUND",
          `Checkpoint "${input.checkpointId}" not found.`,
          { checkpointId: input.checkpointId },
        );
      }

      const revision = createSceneRevision(checkpoint);
      if (input.revision && input.revision !== revision) {
        return errorResult(
          "REVISION_CONFLICT",
          `Scene revision conflict: expected ${input.revision}, current ${revision}.`,
          { checkpointId: input.checkpointId, currentRevision: revision },
        );
      }

      try {
        const graph = querySceneGraph(checkpoint.elements);
        return successResult({
          checkpointId: input.checkpointId,
          revision,
          ...graph,
        });
      } catch (error) {
        return errorResult(
          errorCode(error, "SCENE_GRAPH_FAILED"),
          errorMessage(error),
          {
            checkpointId: input.checkpointId,
            currentRevision: revision,
            ...(isSceneQueryError(error)
              ? { details: errorDetails(error) }
              : {}),
          },
        );
      }
    },
  );

  server.registerTool(
    "apply_scene_operations",
    {
      description:
        "Atomically add native elbow arrows by default, change an arrow type (sharp, round, elbow), or update bound text. Requires a scene revision and per-element version preconditions; success creates one derived checkpoint with an auditable field-level diff.",
      inputSchema: {
        checkpointId: checkpointIdSchema,
        expectedRevision: revisionSchema,
        operations: z.array(operationSchema).min(1).max(100),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input): Promise<CallToolResult> => {
      let checkpoint;
      try {
        checkpoint = await store.load(input.checkpointId);
      } catch (error) {
        return errorResult("CHECKPOINT_LOAD_FAILED", errorMessage(error), {
          checkpointId: input.checkpointId,
        });
      }
      if (!checkpoint) {
        return errorResult(
          "CHECKPOINT_NOT_FOUND",
          `Checkpoint "${input.checkpointId}" not found.`,
          { checkpointId: input.checkpointId },
        );
      }

      const sourceRevision = createSceneRevision(checkpoint);
      if (input.expectedRevision !== sourceRevision) {
        return errorResult(
          "REVISION_CONFLICT",
          `Scene revision conflict: expected ${input.expectedRevision}, current ${sourceRevision}. Read the checkpoint again before editing.`,
          {
            checkpointId: input.checkpointId,
            currentRevision: sourceRevision,
          },
        );
      }

      let transaction;
      try {
        await ensureFontMetrics();
        transaction = applyAtomicSceneEdit(
          checkpoint.elements,
          toAtomicOperations(input.operations),
        );
      } catch (error) {
        return errorResult(
          errorCode(error, "ATOMIC_OPERATION_FAILED"),
          errorMessage(error),
          {
            checkpointId: input.checkpointId,
            currentRevision: sourceRevision,
            ...(isAtomicSceneEditError(error)
              ? { details: atomicErrorDetails(error) }
              : {}),
          },
        );
      }

      const checkpointId = createCheckpointId();
      let derivedCheckpoint;
      try {
        derivedCheckpoint = await store.saveDerived({
          sourceId: input.checkpointId,
          expectedSourceRevision: input.expectedRevision,
          targetId: checkpointId,
          data: {
            elements: transaction.elements,
            remote: checkpoint.remote,
          },
        });
      } catch (error) {
        return errorResult(
          errorCode(error, "CHECKPOINT_SAVE_FAILED"),
          errorMessage(error),
          {
            checkpointId: input.checkpointId,
            currentRevision: sourceRevision,
            ...(isCheckpointStoreError(error)
              ? { details: { targetCheckpointId: checkpointId } }
              : {}),
          },
        );
      }

      return successResult({
        sourceCheckpointId: input.checkpointId,
        sourceRevision,
        checkpointId,
        revision:
          derivedCheckpoint.revision ?? createSceneRevision(derivedCheckpoint),
        affectedElementIds: transaction.affectedElementIds,
        diff: transaction.diff,
      });
    },
  );
}
