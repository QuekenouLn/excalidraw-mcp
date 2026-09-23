import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { MemoryCheckpointStore } from "../src/checkpoint-store";
import { createServer } from "../src/server";

const SAVED_REVISION = `${"a".repeat(64)}`;

describe("Remote File MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let store: MemoryCheckpointStore;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    process.env.REMOTE_STORAGE_URL = "https://remote.test";
    store = new MemoryCheckpointStore();
    server = createServer(store);
    client = new Client({ name: "remote-file-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.REMOTE_STORAGE_URL;
    await client.close();
    await server.close();
  });

  test("registers deletion as destructive and requiring confirmation", async () => {
    const result = await client.listTools();
    const tool = result.tools.find(({ name }) => name === "delete_remote_file");

    expect(tool).toBeDefined();
    expect(tool?.description).toContain("explicitly agrees");
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["name", "expectedRevision", "confirmed"]),
    );
  });

  test("renames with the latest revision and returns remote metadata", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const revision = "a".repeat(64);
    const renamed = {
      name: "renamed-file.excalidraw",
      size: 42,
      updatedAt: "2026-08-22T10:00:00Z",
      revision,
    };
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return Response.json(renamed);
    }) as typeof globalThis.fetch;

    const result = await client.callTool({
      name: "rename_remote_file",
      arguments: {
        name: "original-file.excalidraw",
        newName: renamed.name,
        expectedRevision: revision,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(renamed);
    expect(request?.url).toBe(
      "https://remote.test/files/original-file.excalidraw",
    );
    expect(request?.init).toMatchObject({
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": revision,
      },
      body: JSON.stringify({ name: renamed.name }),
    });
  });

  test("returns remote rename conflicts", async () => {
    globalThis.fetch = (async () =>
      new Response("Target file already exists", {
        status: 409,
      })) as typeof globalThis.fetch;
    const result = await client.callTool({
      name: "rename_remote_file",
      arguments: {
        name: "original-file.excalidraw",
        newName: "existing-file.excalidraw",
        expectedRevision: "b".repeat(64),
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Target file already exists" },
    ]);
  });

  test("deletes with the latest revision after explicit confirmation", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    const revision = "a".repeat(64);
    const result = await client.callTool({
      name: "delete_remote_file",
      arguments: {
        name: "delete-me.excalidraw",
        expectedRevision: revision,
        confirmed: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      name: "delete-me.excalidraw",
      deleted: true,
    });
    expect(request?.url).toBe("https://remote.test/files/delete-me.excalidraw");
    expect(request?.init?.method).toBe("DELETE");
    expect(request?.init?.headers).toEqual({ "If-Match": revision });
  });

  test("rejects calls without explicit confirmation before fetching", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    const result = await client.callTool({
      name: "delete_remote_file",
      arguments: {
        name: "delete-me.excalidraw",
        expectedRevision: "a".repeat(64),
      },
    });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  test("preserves the file when the revision is stale", async () => {
    globalThis.fetch = (async () =>
      new Response("File changed since it was listed", {
        status: 412,
      })) as typeof globalThis.fetch;

    const result = await client.callTool({
      name: "delete_remote_file",
      arguments: {
        name: "delete-me.excalidraw",
        expectedRevision: "b".repeat(64),
        confirmed: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "File changed since it was listed" },
    ]);
  });

  test("save_remote_file persists and returns warnings for a dirty checkpoint", async () => {
    await store.save("dirty_scene", {
      elements: [
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
          x: 80,
          y: 10,
          width: 200,
          height: 80,
        },
        {
          id: "free",
          type: "arrow",
          x: 0,
          y: 200,
          width: 120,
          height: 0,
          startBinding: null,
          endBinding: null,
        },
      ],
    });
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url, init) => {
      request = { url: String(url), init };
      return Response.json({ revision: SAVED_REVISION });
    }) as typeof globalThis.fetch;

    const result = await client.callTool({
      name: "save_remote_file",
      arguments: {
        name: "dirty-scene.excalidraw",
        checkpointId: "dirty_scene",
      },
    });
    const payload = result.structuredContent as {
      name?: string;
      revision?: string;
      checkpointId?: string;
      warnings?: Array<{ type: string }>;
    };

    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      name: "dirty-scene.excalidraw",
      revision: SAVED_REVISION,
      checkpointId: "dirty_scene",
    });
    expect(payload.warnings?.some((warning) => warning.type === "overlap")).toBe(
      true,
    );
    expect(
      payload.warnings?.some((warning) => warning.type === "unbound-arrow"),
    ).toBe(true);
    expect(request?.init?.method).toBe("PUT");
    expect(
      (result.content as Array<{ text?: string }>)
        .map((item) => item.text ?? "")
        .join("\n"),
    ).toContain("Saved dirty-scene.excalidraw");
  });

  test("save_remote_file returns no warnings for a clean bound scene", async () => {
    await store.save("clean_scene", {
      elements: [
        {
          id: "source",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
        },
        {
          id: "target",
          type: "rectangle",
          x: 400,
          y: 0,
          width: 200,
          height: 80,
        },
        {
          id: "edge",
          type: "arrow",
          x: 200,
          y: 40,
          width: 200,
          height: 0,
          startBinding: { elementId: "source", fixedPoint: [1, 0.5] },
          endBinding: { elementId: "target", fixedPoint: [0, 0.5] },
        },
      ],
    });
    globalThis.fetch = (async () =>
      Response.json({ revision: SAVED_REVISION })) as typeof globalThis.fetch;

    const result = await client.callTool({
      name: "save_remote_file",
      arguments: {
        name: "clean-scene.excalidraw",
        checkpointId: "clean_scene",
      },
    });
    const payload = result.structuredContent as {
      name?: string;
      revision?: string;
      warnings?: unknown[];
    };

    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      name: "clean-scene.excalidraw",
      revision: SAVED_REVISION,
    });
    expect(payload.warnings).toEqual([]);
  });
});
