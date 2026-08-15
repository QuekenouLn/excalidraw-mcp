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
          { type: "rectangle", id: "card", x: 0, y: 0, width: 160, height: 80, label: { text: "Card", textAlign: "right" } },
          { type: "text", id: "title", x: 0, y: 100, text: "Title", fontSize: 24, textAlign: "left", verticalAlign: "bottom" },
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
    expect(title).toMatchObject({
      fontFamily: 11,
      textAlign: "center",
      verticalAlign: "bottom",
    });
    expect(label).toMatchObject({
      fontFamily: 11,
      textAlign: "center",
    });
  });

  test("keeps checkpoint elements unchanged while styling additions", async () => {
    const existing = {
      id: "existing-text",
      type: "text",
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      text: "Existing",
      fontSize: 20,
      fontFamily: 5,
      lineHeight: 1.2,
      textAlign: "right",
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
          { type: "text", id: "new", x: 200, y: 0, text: "New", fontSize: 20, textAlign: "left" },
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
      textAlign: "center",
    });
    expect(await store.load("style_source")).toEqual({ elements: [existing] });
  });
});
