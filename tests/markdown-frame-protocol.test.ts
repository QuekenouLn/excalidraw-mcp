import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryCheckpointStore } from "../src/checkpoint-store";
import { createMarkdownFrameHtml } from "../src/markdown-frame";
import { createServer } from "../src/server";

describe("Markdown Frame MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let store: MemoryCheckpointStore;

  beforeEach(async () => {
    store = new MemoryCheckpointStore();
    await store.save("markdown_protocol_source", {
      elements: [
        {
          id: "markdown-1",
          type: "iframe",
          x: 10,
          y: 20,
          width: 400,
          height: 240,
          version: 3,
          versionNonce: 10,
          updated: 1,
          customData: {
            generationData: {
              status: "done",
              html: createMarkdownFrameHtml("# Architecture\n\nOld body"),
            },
            markdownFrame: {
              markdown: "# Architecture\n\nOld body",
              contentScale: 1,
              theme: "aurora",
              version: 1,
            },
          },
        },
        { id: "rect-1", type: "rectangle", version: 1 },
      ],
      remote: {
        name: "architecture.excalidraw",
        revision: "remote-revision",
        document: {
          type: "excalidraw",
          appState: {},
          files: {},
        },
      },
    });

    server = createServer(store);
    client = new Client({ name: "markdown-frame-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  test("registers discoverable Markdown tools", async () => {
    const result = await client.listTools();
    const tools = result.tools.filter((tool) =>
      tool.name.includes("markdown_frame"),
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      "create_markdown_frame",
      "query_markdown_frames",
      "get_markdown_frame",
      "update_markdown_frame",
      "delete_markdown_frame",
    ]);
    expect(tools[0].annotations?.destructiveHint).toBe(false);
    expect(tools[1].annotations?.readOnlyHint).toBe(true);
    expect(tools[2].annotations?.readOnlyHint).toBe(true);
    expect(tools[3].annotations?.readOnlyHint).toBe(false);
    expect(tools[4].annotations?.destructiveHint).toBe(true);
  });

  test("creates a safe Markdown Frame while preserving the source", async () => {
    const before = await store.load("markdown_protocol_source");
    const create = await client.callTool({
      name: "create_markdown_frame",
      arguments: {
        checkpointId: "markdown_protocol_source",
        markdown: "# Created\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))",
        x: 500,
        y: 100,
      },
    });
    expect(create.isError).not.toBe(true);
    const result = create.structuredContent as any;
    const after = await store.load(result.checkpointId);
    expect(await store.load("markdown_protocol_source")).toEqual(before);
    expect(after?.remote).toEqual(before?.remote);
    expect(after?.elements.slice(0, -1)).toEqual(before?.elements);
    const created = after?.elements.at(-1);
    expect(created.roundness).toBeNull();
    expect(created.customData.generationData.html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(created.customData.generationData.html).toContain('href="#"');

    const get = await client.callTool({
      name: "get_markdown_frame",
      arguments: { checkpointId: result.checkpointId, frameId: result.frame.id },
    });
    expect((get.structuredContent as any).frame.markdown).toContain("# Created");
  });

  test("queries, reads, and updates through MCP", async () => {
    const query = await client.callTool({
      name: "query_markdown_frames",
      arguments: {
        checkpointId: "markdown_protocol_source",
        query: "architecture",
      },
    });
    expect(query.isError).not.toBe(true);
    expect((query.structuredContent as any).total).toBe(1);
    expect(JSON.stringify(query.structuredContent)).not.toContain(
      "generationData",
    );

    const get = await client.callTool({
      name: "get_markdown_frame",
      arguments: {
        checkpointId: "markdown_protocol_source",
        frameId: "markdown-1",
      },
    });
    expect((get.structuredContent as any).frame.markdown).toContain("Old body");

    const update = await client.callTool({
      name: "update_markdown_frame",
      arguments: {
        checkpointId: "markdown_protocol_source",
        frameId: "markdown-1",
        expectedElementVersion: 3,
        operation: "find_replace",
        find: "Old body",
        replace: "New body",
      },
    });
    expect(update.isError).not.toBe(true);
    const updateResult = update.structuredContent as any;
    expect(updateResult.sourceCheckpointId).toBe("markdown_protocol_source");
    expect(updateResult.checkpointId).not.toBe("markdown_protocol_source");
    expect(updateResult.frame.elementVersion).toBe(4);
    expect(updateResult.frame.markdown).toContain("New body");

    const source = await store.load("markdown_protocol_source");
    const derived = await store.load(updateResult.checkpointId);
    expect(source?.elements[0].customData.markdownFrame.markdown).toContain(
      "Old body",
    );
    expect(derived?.elements[0].customData.markdownFrame.markdown).toContain(
      "New body",
    );
    expect(derived?.elements[0].customData.generationData.html).toContain(
      "New body",
    );
    expect(derived?.remote).toEqual(source?.remote);
    expect(derived?.elements[1]).toEqual(source?.elements[1]);
  });

  test("rejects stale element versions without creating an update", async () => {
    const result = await client.callTool({
      name: "update_markdown_frame",
      arguments: {
        checkpointId: "markdown_protocol_source",
        frameId: "markdown-1",
        expectedElementVersion: 2,
        operation: "replace",
        markdown: "# Stale write",
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("version conflict");
    const source = await store.load("markdown_protocol_source");
    expect(source?.elements[0].version).toBe(3);
  });

  test("deletes a Markdown Frame into a new checkpoint", async () => {
    const before = await store.load("markdown_protocol_source");
    const result = await client.callTool({
      name: "delete_markdown_frame",
      arguments: {
        checkpointId: "markdown_protocol_source",
        frameId: "markdown-1",
        expectedElementVersion: 3,
      },
    });
    expect(result.isError).not.toBe(true);
    const deletion = result.structuredContent as any;
    const derived = await store.load(deletion.checkpointId);
    expect(await store.load("markdown_protocol_source")).toEqual(before);
    expect(derived?.remote).toEqual(before?.remote);
    expect(derived?.elements.map((element) => element.id)).toEqual(["rect-1"]);

    const query = await client.callTool({
      name: "query_markdown_frames",
      arguments: { checkpointId: deletion.checkpointId },
    });
    expect((query.structuredContent as any).total).toBe(0);
  });

  test("rejects stale delete versions without changing the source", async () => {
    const before = await store.load("markdown_protocol_source");
    const result = await client.callTool({
      name: "delete_markdown_frame",
      arguments: {
        checkpointId: "markdown_protocol_source",
        frameId: "markdown-1",
        expectedElementVersion: 2,
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("version conflict");
    expect(await store.load("markdown_protocol_source")).toEqual(before);
  });
});
