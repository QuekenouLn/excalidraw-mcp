import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryCheckpointStore } from "../src/checkpoint-store";
import { createServer } from "../src/server";

describe("create_view style protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let store: MemoryCheckpointStore;

  beforeEach(async () => {
    store = new MemoryCheckpointStore();
    server = createServer(store);
    client = new Client({ name: "style-test", version: "1.0.0" });
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

  test("applies defaults to new elements", async () => {
    const result = await client.callTool({
      name: "create_view",
      arguments: {
        elements: JSON.stringify([
          { type: "rectangle", id: "card", x: 0, y: 0, width: 160, height: 80, label: { text: "Card" } },
          { type: "text", id: "title", x: 0, y: 100, text: "Title", fontSize: 24 },
        ]),
      },
    });
    const checkpoint = await store.load(
      (result.structuredContent as any).checkpointId,
    );
    const card = checkpoint?.elements.find((element) => element.id === "card");
    const title = checkpoint?.elements.find((element) => element.id === "title");
    const label = checkpoint?.elements.find(
      (element) => element.containerId === "card",
    );

    expect(card).toMatchObject({
      strokeWidth: 1,
      roundness: { type: 3, value: 12 },
    });
    expect(title.fontFamily).toBe(11);
    expect(label.fontFamily).toBe(11);
  });

  test("keeps checkpoint elements unchanged while styling additions", async () => {
    const existing = {
      id: "existing",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      strokeWidth: 4,
      roundness: null,
      version: 7,
      versionNonce: 8,
      customData: { owner: "user" },
    };
    await store.save("style_source", { elements: [existing] });

    const result = await client.callTool({
      name: "create_view",
      arguments: {
        elements: JSON.stringify([
          { type: "restoreCheckpoint", id: "style_source" },
          { type: "rectangle", id: "new", x: 200, y: 0, width: 120, height: 60 },
        ]),
      },
    });
    const checkpoint = await store.load(
      (result.structuredContent as any).checkpointId,
    );

    expect(checkpoint?.elements[0]).toEqual(existing);
    expect(checkpoint?.elements[1]).toMatchObject({
      id: "new",
      index: "a1",
      strokeWidth: 1,
      roundness: { type: 3, value: 12 },
    });
    expect(await store.load("style_source")).toEqual({ elements: [existing] });
  });
});
