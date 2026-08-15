import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryCheckpointStore } from "../src/checkpoint-store";
import { createServer } from "../src/server";

describe("Remote File MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    process.env.REMOTE_STORAGE_URL = "https://remote.test";
    server = createServer(new MemoryCheckpointStore());
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
      new Response("File changed since it was listed", { status: 412 })) as typeof globalThis.fetch;

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
});
