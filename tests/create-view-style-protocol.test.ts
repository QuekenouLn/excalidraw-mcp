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
          {
            type: "rectangle",
            id: "card",
            x: 0,
            y: 0,
            width: 160,
            height: 80,
            label: { text: "Card", textAlign: "right" },
          },
          {
            type: "text",
            id: "title",
            x: 0,
            y: 100,
            text: "Title",
            fontSize: 24,
            textAlign: "left",
            verticalAlign: "bottom",
          },
        ]),
      },
    });
    const checkpoint = await store.load(
      (result.structuredContent as any).checkpointId,
    );
    const card = checkpoint?.elements.find((element) => element.id === "card");
    const title = checkpoint?.elements.find(
      (element) => element.id === "title",
    );
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
          {
            type: "text",
            id: "new",
            x: 200,
            y: 0,
            text: "New",
            fontSize: 20,
            textAlign: "left",
          },
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

  test("returns overlap and unbound-arrow warnings without failing", async () => {
    const result = await client.callTool({
      name: "create_view",
      arguments: {
        elements: JSON.stringify([
          {
            type: "rectangle",
            id: "left",
            x: 0,
            y: 0,
            width: 200,
            height: 80,
            label: { text: "Left" },
          },
          {
            type: "rectangle",
            id: "right",
            x: 80,
            y: 10,
            width: 200,
            height: 80,
            label: { text: "Right" },
          },
          {
            type: "arrow",
            id: "free",
            x: 0,
            y: 200,
            width: 120,
            height: 0,
            points: [
              [0, 0],
              [120, 0],
            ],
          },
        ]),
      },
    });
    const payload = result.structuredContent as {
      checkpointId?: string;
      warnings?: Array<{ type: string }>;
    };
    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((item) => item.text ?? "")
      .join("\n");

    expect(result.isError).not.toBe(true);
    expect(payload.checkpointId).toEqual(expect.any(String));
    expect(payload.warnings?.some((warning) => warning.type === "overlap")).toBe(
      true,
    );
    expect(
      payload.warnings?.some((warning) => warning.type === "unbound-arrow"),
    ).toBe(true);
    expect(text).not.toContain("read_widget_context");
    expect(text).not.toContain("restoreCheckpoint");
    expect(text).toContain(`Checkpoint "${payload.checkpointId}"`);
  });

  test("returns an empty warnings list for a clean labeled two-box scene", async () => {
    const result = await client.callTool({
      name: "create_view",
      arguments: {
        elements: JSON.stringify([
          {
            type: "rectangle",
            id: "source",
            x: 0,
            y: 0,
            width: 200,
            height: 80,
            label: { text: "Start" },
          },
          {
            type: "rectangle",
            id: "target",
            x: 400,
            y: 0,
            width: 200,
            height: 80,
            label: { text: "End" },
          },
          {
            type: "arrow",
            id: "edge",
            x: 200,
            y: 40,
            width: 200,
            height: 0,
            points: [
              [0, 0],
              [200, 0],
            ],
            startBinding: { elementId: "source", fixedPoint: [1, 0.5] },
            endBinding: { elementId: "target", fixedPoint: [0, 0.5] },
          },
        ]),
      },
    });
    const payload = result.structuredContent as {
      checkpointId?: string;
      warnings?: unknown[];
    };

    expect(result.isError).not.toBe(true);
    expect(payload.checkpointId).toEqual(expect.any(String));
    expect(payload.warnings).toEqual([]);
  });
});
