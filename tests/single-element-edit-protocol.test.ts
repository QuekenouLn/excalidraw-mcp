import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  MemoryCheckpointStore,
  computeCheckpointRevision,
} from "../src/checkpoint-store";
import { createServer } from "../src/server";
import { convertElementsForStorage } from "../src/server-element-conversion";
import companyScene from "./fixtures/company-single-card.json";

const frameId = "markdown_b0661b773012472cae";
const templateId = "spaced-workspace-docs-v3";
const expectation = (element: any) => ({
  id: element.id,
  version: element.version,
  versionNonce: element.versionNonce,
});

describe("single-element edits through MCP", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let store: MemoryCheckpointStore;
  beforeEach(async () => {
    store = new MemoryCheckpointStore();
    await store.save("single_source", {
      elements: structuredClone(companyScene),
    });
    server = createServer(store);
    client = new Client({ name: "single-edit-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
  });
  afterEach(async () => {
    await client.close();
    await server.close();
  });
  async function edit(extra: Record<string, unknown>, targetId = frameId) {
    const source = (await store.load("single_source"))!;
    return client.callTool({
      name: "edit_scene_element",
      arguments: {
        checkpointId: "single_source",
        expectedRevision: computeCheckpointRevision(source),
        target: expectation(
          source.elements.find((element) => element.id === targetId),
        ),
        ...extra,
      },
    });
  }
  test("replaces the actual company Markdown card without moving any of the five external labels", async () => {
    const template = companyScene.find((element) => element.id === templateId)!;
    const result = await edit({
      replaceWithCard: {
        text: "独立文档流程\ninit-doc 生成画像\nsync-summary 合并",
        styleFrom: expectation(template),
      },
    });
    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as any;
    expect(payload.affectedElementIds).toEqual([frameId, `${frameId}__label`]);
    const saved = (await store.load(payload.checkpointId))!;
    for (const element of companyScene.filter(
      (element) => element.id !== frameId,
    )) {
      expect(saved.elements.find((item) => item.id === element.id)).toEqual(
        element,
      );
    }
    const original = companyScene.find((element) => element.id === frameId)!;
    const card = saved.elements.find((element) => element.id === frameId)!;
    expect(card).toMatchObject({
      type: "rectangle",
      x: original.x,
      y: original.y,
      width: original.width,
      height: original.height,
      backgroundColor: template.backgroundColor,
      version: original.version + 1,
    });
    expect(card.customData).toBeUndefined();
    expect(
      saved.elements.find((element) => element.id === `${frameId}__label`)
        ?.containerId,
    ).toBe(frameId);
    expect((await store.load("single_source"))?.elements).toEqual(companyScene);
  });
  test("restore plus a new card preserves actual external arrow label coordinates", async () => {
    const result = await client.callTool({
      name: "create_view",
      arguments: {
        elements: JSON.stringify([
          { type: "restoreCheckpoint", id: "single_source" },
          {
            type: "rectangle",
            id: "added",
            x: 70,
            y: 2000,
            width: 440,
            height: 120,
            label: { text: "New" },
          },
        ]),
      },
    });
    const checkpoint = (await store.load(
      (result.structuredContent as any).checkpointId,
    ))!;
    for (const element of companyScene) {
      expect(
        checkpoint.elements.find((item) => item.id === element.id),
      ).toEqual(element);
    }
  });
  test("changes just one arrowhead and preserves points, bindings and all other elements", async () => {
    const arrow = companyScene.find((element) => element.type === "arrow")!;
    const result = await edit(
      { changes: { startArrowhead: "dot", endArrowhead: "triangle" } },
      arrow.id,
    );
    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as any;
    expect(payload.affectedElementIds).toEqual([arrow.id]);
    const checkpoint = (await store.load(payload.checkpointId))!;
    const updated = checkpoint.elements.find(
      (element) => element.id === arrow.id,
    )!;
    expect(updated).toMatchObject({
      startArrowhead: "dot",
      endArrowhead: "triangle",
      points: arrow.points,
      startBinding: arrow.startBinding,
      endBinding: arrow.endBinding,
    });
    for (const element of companyScene.filter(
      (element) => element.id !== arrow.id,
    )) {
      expect(
        checkpoint.elements.find((item) => item.id === element.id),
      ).toEqual(element);
    }
  });
  test("changes one node label without reading or changing the rest of the graph", async () => {
    const result = await edit({ text: "StrategyHelper\n策略助手" }, templateId);
    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as any;
    expect(payload.affectedElementIds).toEqual([`${templateId}__label`]);
    const checkpoint = (await store.load(payload.checkpointId))!;
    for (const element of companyScene.filter(
      (element) => element.id !== `${templateId}__label`,
    )) {
      expect(
        checkpoint.elements.find((item) => item.id === element.id),
      ).toEqual(element);
    }
  });

  test("batch arrow edits honor an explicit affected-element allowlist", async () => {
    const source = (await store.load("single_source"))!;
    const arrow = source.elements.find((element) => element.type === "arrow")!;
    const result = await client.callTool({
      name: "apply_scene_operations",
      arguments: {
        checkpointId: "single_source",
        expectedRevision: computeCheckpointRevision(source),
        operations: [
          {
            type: "set_arrow_type",
            edge: expectation(arrow),
            arrowType: "sharp",
          },
        ],
        allowedElementIds: [arrow.id],
      },
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).error.code).toBe(
      "INVARIANT_VIOLATION",
    );
    expect((await store.load("single_source"))?.elements).toEqual(companyScene);
  });

  test("changes one node style without touching any other element", async () => {
    const result = await edit(
      { changes: { backgroundColor: "#b2f2bb", strokeWidth: 3 } },
      templateId,
    );
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as any).affectedElementIds).toEqual([
      templateId,
    ]);
  });
  test("moves a connected node only when its affected arrow is explicitly allowed", async () => {
    const elements = convertElementsForStorage([
      {
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        label: { text: "A" },
      },
      { type: "rectangle", id: "b", x: 500, y: 0, width: 200, height: 100 },
      { type: "arrow", id: "edge", start: { id: "a" }, end: { id: "b" } },
    ]);
    await store.save("single_source", { elements });
    const derivedSave = spyOn(store, "saveDerived");
    const rejected = await edit({ changes: { x: 50 } }, "a");
    expect(rejected.isError).toBe(true);
    expect((rejected.structuredContent as any).error.code).toBe(
      "INVARIANT_VIOLATION",
    );
    expect(derivedSave).not.toHaveBeenCalled();
    expect((await store.load("single_source"))?.elements).toEqual(elements);
    const accepted = await edit(
      { changes: { x: 50 }, allowedElementIds: ["edge"] },
      "a",
    );
    expect(accepted.isError).not.toBe(true);
    expect(derivedSave).toHaveBeenCalledTimes(1);
    const payload = accepted.structuredContent as any;
    expect(payload.affectedElementIds.sort()).toEqual([
      "a",
      "a__label",
      "edge",
    ]);
    const checkpoint = (await store.load(payload.checkpointId))!;
    expect(checkpoint.elements.find((element) => element.id === "b")).toEqual(
      elements.find((element) => element.id === "b"),
    );
  });
  test("rejects stale versions, stale revisions and protected fields", async () => {
    const staleVersion = await edit({
      target: { id: templateId, version: 1, versionNonce: 0 },
      changes: { opacity: 80 },
    });
    expect((staleVersion.structuredContent as any).error.code).toBe(
      "VERSION_CONFLICT",
    );
    const staleRevision = await edit(
      { expectedRevision: "0".repeat(64), changes: { opacity: 80 } },
      templateId,
    );
    expect((staleRevision.structuredContent as any).error.code).toBe(
      "REVISION_CONFLICT",
    );
    const protectedField = await edit(
      { changes: { version: 999 } },
      templateId,
    );
    expect(protectedField.isError).toBe(true);
    expect((await store.load("single_source"))?.elements).toEqual(companyScene);
  });
  test("rejects an overflowing card instead of silently changing its dimensions", async () => {
    const result = await edit({
      replaceWithCard: { text: "very long text ".repeat(500) },
    });
    expect(result.isError).toBe(true);
    expect((await store.load("single_source"))?.elements).toEqual(companyScene);
  });
});
