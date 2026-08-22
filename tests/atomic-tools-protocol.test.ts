import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  MemoryCheckpointStore,
  type CheckpointData,
  type SaveDerivedCheckpointOptions,
} from "../src/checkpoint-store";
import { createServer } from "../src/server";
import {
  ATOMIC_SCENE_IDS,
  createAtomicScene,
  mapElementsById,
} from "./fixtures/atomic-scene";

const SOURCE_CHECKPOINT_ID = "atomic_protocol_source";

class RecordingCheckpointStore extends MemoryCheckpointStore {
  readonly derivedCheckpointIds: string[] = [];
  derivedSaveAttempts = 0;

  override async save(id: string, data: CheckpointData): Promise<void> {
    await super.save(id, data);
    if (id !== SOURCE_CHECKPOINT_ID) {
      this.derivedCheckpointIds.push(id);
    }
  }

  override async saveDerived(
    options: SaveDerivedCheckpointOptions,
  ): Promise<CheckpointData> {
    this.derivedSaveAttempts += 1;
    const checkpoint = await super.saveDerived(options);
    this.derivedCheckpointIds.push(options.targetId);
    return checkpoint;
  }
}

describe("Atomic scene tools MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let store: RecordingCheckpointStore;

  beforeEach(async () => {
    store = new RecordingCheckpointStore();
    await store.save(SOURCE_CHECKPOINT_ID, {
      elements: createAtomicScene(),
      remote: {
        name: "atomic-scene.excalidraw",
        revision: "remote-source-revision",
        document: {
          type: "excalidraw",
          appState: { theme: "light" },
          files: {},
        },
      },
    });

    server = createServer(store);
    client = new Client({ name: "atomic-tools-test", version: "1.0.0" });
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

  test("registers the model-visible atomic scene tools", async () => {
    const result = await client.listTools();
    const tools = result.tools.filter((tool) =>
      [
        "select_scene_elements",
        "query_scene_graph",
        "apply_scene_operations",
      ].includes(tool.name),
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "select_scene_elements",
      "query_scene_graph",
      "apply_scene_operations",
    ]);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
    expect(tools[1].annotations?.readOnlyHint).toBe(true);
    expect(tools[2].annotations?.readOnlyHint).toBe(false);
    expect(tools[2].annotations?.destructiveHint).toBe(false);
  });

  test("queries a real checkpoint through selection and graph tools", async () => {
    const selection = await client.callTool({
      name: "select_scene_elements",
      arguments: {
        checkpointId: SOURCE_CHECKPOINT_ID,
        text: "Gamma",
        textMatch: "exact",
      },
    });

    expect(selection.isError).not.toBe(true);
    const selected = selection.structuredContent as any;
    expect(selected.checkpointId).toBe(SOURCE_CHECKPOINT_ID);
    expect(selected.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(selected.total).toBe(1);
    expect(selected.matches[0]).toMatchObject({
      id: ATOMIC_SCENE_IDS.nodes.c,
      type: "rectangle",
      version: 1,
      boundText: {
        id: ATOMIC_SCENE_IDS.nodeTexts.c,
        text: "Gamma",
        version: 1,
      },
    });

    const graph = await client.callTool({
      name: "query_scene_graph",
      arguments: {
        checkpointId: SOURCE_CHECKPOINT_ID,
        revision: selected.revision,
      },
    });

    expect(graph.isError).not.toBe(true);
    const projected = graph.structuredContent as any;
    expect(projected.revision).toBe(selected.revision);
    expect(projected.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ATOMIC_SCENE_IDS.nodes.a,
          text: "Alpha",
          version: 1,
        }),
      ]),
    );
    expect(projected.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ATOMIC_SCENE_IDS.arrows.forward,
          direction: "forward",
          sourceId: ATOMIC_SCENE_IDS.nodes.a,
          targetId: ATOMIC_SCENE_IDS.nodes.b,
          text: "forward edge",
        }),
        expect.objectContaining({
          id: ATOMIC_SCENE_IDS.arrows.dangling,
          end: expect.objectContaining({ status: "free" }),
        }),
      ]),
    );
    expect(store.derivedCheckpointIds).toEqual([]);
    expect(store.derivedSaveAttempts).toBe(0);
  });

  test("applies an exact update into one new checkpoint with an audit diff", async () => {
    const sourceBefore = await store.load(SOURCE_CHECKPOINT_ID);
    const sourceElements = mapElementsById(createAtomicScene());
    const target = sourceElements.get(ATOMIC_SCENE_IDS.nodes.c)!;
    const revision = await readSourceRevision();

    const update = await client.callTool({
      name: "apply_scene_operations",
      arguments: {
        checkpointId: SOURCE_CHECKPOINT_ID,
        expectedRevision: revision,
        operations: [
          {
            type: "set_node_label",
            node: {
              id: target.id,
              version: target.version,
              versionNonce: target.versionNonce,
            },
            text: "Delta",
          },
        ],
      },
    });

    expect(update.isError).not.toBe(true);
    const result = update.structuredContent as any;
    expect(result.sourceCheckpointId).toBe(SOURCE_CHECKPOINT_ID);
    expect(result.sourceRevision).toBe(revision);
    expect(result.checkpointId).not.toBe(SOURCE_CHECKPOINT_ID);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(result.revision).not.toBe(revision);
    expect(result.diff.direct).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: ATOMIC_SCENE_IDS.nodeTexts.c,
          field: "text",
          before: "Gamma",
          after: "Delta",
        }),
        expect.objectContaining({
          elementId: ATOMIC_SCENE_IDS.nodeTexts.c,
          field: "originalText",
          before: "Gamma",
          after: "Delta",
        }),
      ]),
    );
    expect(result.diff.derived).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: ATOMIC_SCENE_IDS.nodeTexts.c,
          field: "version",
          before: 1,
          after: 2,
        }),
      ]),
    );
    expect(store.derivedCheckpointIds).toEqual([result.checkpointId]);
    expect(store.derivedSaveAttempts).toBe(1);

    const sourceAfter = await store.load(SOURCE_CHECKPOINT_ID);
    const derived = await store.load(result.checkpointId);
    expect(sourceAfter).toEqual(sourceBefore);
    expect(derived).not.toBeNull();
    expect(derived?.remote).toEqual(sourceBefore?.remote);

    const sourceById = mapElementsById(sourceBefore!.elements);
    const derivedById = mapElementsById(derived!.elements);
    expect(sourceById.get(ATOMIC_SCENE_IDS.nodeTexts.c)).toMatchObject({
      text: "Gamma",
      originalText: "Gamma",
      version: 1,
    });
    expect(derivedById.get(ATOMIC_SCENE_IDS.nodeTexts.c)).toMatchObject({
      text: "Delta",
      originalText: "Delta",
      version: 2,
    });
    expect(derivedById.get(ATOMIC_SCENE_IDS.unrelated)).toEqual(
      sourceById.get(ATOMIC_SCENE_IDS.unrelated),
    );
  });

  test("rejects revision conflicts and operation failures without saving", async () => {
    const sourceBefore = await store.load(SOURCE_CHECKPOINT_ID);
    const target = mapElementsById(createAtomicScene()).get(
      ATOMIC_SCENE_IDS.nodes.a,
    )!;
    const revision = await readSourceRevision();

    const conflict = await client.callTool({
      name: "apply_scene_operations",
      arguments: {
        checkpointId: SOURCE_CHECKPOINT_ID,
        expectedRevision: "0".repeat(64),
        operations: [
          {
            type: "set_node_label",
            node: {
              id: target.id,
              version: target.version,
              versionNonce: target.versionNonce,
            },
            text: "Must not be saved",
          },
        ],
      },
    });

    expect(conflict.isError).toBe(true);
    expect((conflict.structuredContent as any).error).toMatchObject({
      code: "REVISION_CONFLICT",
      checkpointId: SOURCE_CHECKPOINT_ID,
      currentRevision: revision,
    });
    expect(store.derivedCheckpointIds).toEqual([]);
    expect(store.derivedSaveAttempts).toBe(0);
    expect(await store.load(SOURCE_CHECKPOINT_ID)).toEqual(sourceBefore);

    const failedOperation = await client.callTool({
      name: "apply_scene_operations",
      arguments: {
        checkpointId: SOURCE_CHECKPOINT_ID,
        expectedRevision: revision,
        operations: [
          {
            type: "set_node_label",
            node: {
              id: target.id,
              version: target.version + 1,
              versionNonce: target.versionNonce,
            },
            text: "Still must not be saved",
          },
        ],
      },
    });

    expect(failedOperation.isError).toBe(true);
    expect((failedOperation.structuredContent as any).error.code).toMatch(
      /VERSION_CONFLICT/,
    );
    expect(store.derivedCheckpointIds).toEqual([]);
    expect(store.derivedSaveAttempts).toBe(0);
    expect(await store.load(SOURCE_CHECKPOINT_ID)).toEqual(sourceBefore);
  });

  async function readSourceRevision(): Promise<string> {
    const result = await client.callTool({
      name: "select_scene_elements",
      arguments: {
        checkpointId: SOURCE_CHECKPOINT_ID,
        ids: [ATOMIC_SCENE_IDS.nodes.a],
      },
    });
    expect(result.isError).not.toBe(true);
    return (result.structuredContent as any).revision;
  }
});
