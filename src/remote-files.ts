import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import crypto from "node:crypto";
import { z } from "zod/v4";

import type { CheckpointData, CheckpointStore } from "./checkpoint-store.js";

const MAX_REMOTE_BYTES = 5 * 1024 * 1024;
const filenameSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*\.excalidraw$/u);

type RemoteFile = {
  name: string;
  size: number;
  updatedAt: string;
  revision: string;
};

type ExcalidrawDocument = {
  type: string;
  version?: number;
  source?: string;
  elements: any[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

const remoteBaseUrl = () => {
  const value = process.env.REMOTE_STORAGE_URL;
  if (!value) {
    throw new Error("REMOTE_STORAGE_URL is not configured");
  }
  return value.replace(/\/$/, "");
};

const fileUrl = (name: string) => `${remoteBaseUrl()}/files/${encodeURIComponent(name)}`;

const request = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `Remote storage returned ${response.status}`);
  }
  return response;
};

const errorResult = (error: unknown): CallToolResult => ({
  content: [{ type: "text", text: (error as Error).message }],
  isError: true,
});

export function registerRemoteFileTools(server: McpServer, store: CheckpointStore): void {
  server.registerTool(
    "list_remote_files",
    {
      description: "List persistent .excalidraw files stored in the user's private remote file service.",
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (): Promise<CallToolResult> => {
      try {
        const response = await request(`${remoteBaseUrl()}/files`);
        const files = (await response.json()) as RemoteFile[];
        return {
          content: [{ type: "text", text: JSON.stringify(files) }],
          structuredContent: { files },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "open_remote_file",
    {
      description: "Load a persistent .excalidraw file into a checkpoint. Then call create_view with restoreCheckpoint to display or edit it.",
      inputSchema: { name: filenameSchema },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ name }): Promise<CallToolResult> => {
      try {
        const response = await request(fileUrl(name));
        const contentLength = Number(response.headers.get("Content-Length") || 0);
        if (contentLength > MAX_REMOTE_BYTES) {
          throw new Error(`Remote file exceeds ${MAX_REMOTE_BYTES} byte MCP limit`);
        }
        const raw = await response.text();
        if (raw.length > MAX_REMOTE_BYTES) {
          throw new Error(`Remote file exceeds ${MAX_REMOTE_BYTES} byte MCP limit`);
        }
        const document = JSON.parse(raw) as ExcalidrawDocument;
        if (document.type !== "excalidraw" || !Array.isArray(document.elements)) {
          throw new Error("Remote file is not a valid Excalidraw document");
        }
        const revision = response.headers.get("ETag")?.replaceAll('"', "") || "";
        const checkpointId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
        const checkpoint: CheckpointData = {
          elements: document.elements,
          remote: {
            name,
            revision,
            document: {
              type: document.type,
              version: document.version,
              source: document.source,
              appState: document.appState || {},
              files: document.files || {},
            },
          },
        };
        await store.save(checkpointId, checkpoint);
        const result = {
          name,
          revision,
          checkpointId,
          elementCount: document.elements.length,
          hasFiles: Object.keys(document.files || {}).length > 0,
        };
        return {
          content: [{ type: "text", text: `Opened ${name}. Call create_view with [{"type":"restoreCheckpoint","id":"${checkpointId}"}] to display it.` }],
          structuredContent: result,
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "save_remote_file",
    {
      description: "Persist a checkpoint as a complete .excalidraw file while preserving appState and embedded files from the opened document.",
      inputSchema: {
        name: filenameSchema,
        checkpointId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ name, checkpointId, expectedRevision }): Promise<CallToolResult> => {
      try {
        const checkpoint = await store.load(checkpointId);
        if (!checkpoint) {
          throw new Error(`Checkpoint "${checkpointId}" not found`);
        }
        const isOriginalFile = checkpoint.remote?.name === name;
        const revision = expectedRevision || (isOriginalFile ? checkpoint.remote?.revision : undefined);
        if (isOriginalFile && !revision) {
          throw new Error("expectedRevision is required when overwriting a remote file");
        }
        const base = checkpoint.remote?.document;
        const document: ExcalidrawDocument = {
          type: base?.type || "excalidraw",
          version: base?.version || 2,
          source: base?.source || "excalidraw-mcp",
          elements: checkpoint.elements,
          appState: base?.appState || {},
          files: base?.files || {},
        };
        const response = await request(fileUrl(name), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "If-Match": revision || "*",
          },
          body: JSON.stringify(document),
        });
        const saved = (await response.json()) as { revision: string };
        await store.save(checkpointId, {
          ...checkpoint,
          remote: {
            name,
            revision: saved.revision,
            document: {
              type: document.type,
              version: document.version,
              source: document.source,
              appState: document.appState || {},
              files: document.files || {},
            },
          },
        });
        return {
          content: [{ type: "text", text: `Saved ${name} at revision ${saved.revision}.` }],
          structuredContent: { name, revision: saved.revision, checkpointId },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
