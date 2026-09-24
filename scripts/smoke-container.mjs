#!/usr/bin/env node
// Run against a built runtime image, without source mounts or network access.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const image = process.argv[2];
if (!image) {
  throw new Error("Usage: node scripts/smoke-container.mjs <image>");
}
const client = new Client({
  name: "native-elbow-container-smoke",
  version: "1.0.0",
});
const fontPath = fileURLToPath(
  new URL(
    "../../../packages/excalidraw/fonts/MapleMonoNFCN/MapleMono-NF-CN-Regular.woff2",
    import.meta.url,
  ),
);
const transport = new StdioClientTransport({
  command: "docker",
  args: [
    "run",
    "--rm",
    "--network",
    "none",
    "--mount",
    `type=bind,src=${fontPath},dst=/font.woff2,readonly`,
    "-e",
    "MCP_MAPLE_FONT_PATH=/font.woff2",
    "-i",
    image,
    "node",
    "dist/index.js",
    "--stdio",
  ],
  stderr: "inherit",
});
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
};
const reference = ({ id, version, versionNonce }) => ({
  id,
  version,
  versionNonce,
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const edit = tools.tools.find(
    (tool) => tool.name === "apply_scene_operations",
  );
  assert.ok(JSON.stringify(edit.inputSchema).includes("set_arrow_type"));
  const created = await call("create_view", {
    elements: JSON.stringify([
      {
        id: "a",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        label: { text: "A" },
      },
      { id: "b", type: "rectangle", x: 400, y: 160, width: 100, height: 80 },
      {
        id: "e",
        type: "arrow",
        x: 100,
        y: 40,
        width: 300,
        height: 160,
        points: [
          [0, 0],
          [300, 160],
        ],
        start: { id: "a" },
        end: { id: "b" },
        label: { text: "calls" },
      },
      {
        id: "rotated",
        type: "arrow",
        x: 0,
        y: 400,
        width: 100,
        height: 0,
        angle: Math.PI / 2,
        elbowed: false,
        roughness: 0,
        roundness: null,
        points: [
          [0, 0],
          [100, 0],
        ],
      },
    ]),
  });
  const source = await call("read_checkpoint", { id: created.checkpointId });
  const byId = new Map(source.elements.map((element) => [element.id, element]));
  const selected = await call("select_scene_elements", {
    checkpointId: created.checkpointId,
    id: "a",
  });
  const updated = await call("apply_scene_operations", {
    checkpointId: created.checkpointId,
    expectedRevision: selected.revision,
    operations: [
      {
        type: "set_node_label",
        node: reference(byId.get("a")),
        text: "Renamed",
      },
      {
        type: "set_arrow_type",
        edge: reference(byId.get("rotated")),
        arrowType: "elbow",
      },
    ],
  });
  const saved = await call("read_checkpoint", { id: updated.checkpointId });
  const arrow = saved.elements.find((element) => element.id === "e");
  assert.equal(arrow.elbowed, true);
  assert.ok(arrow.points.length > 2);
  assert.ok(
    arrow.points.every(
      (point, index) =>
        index === 0 ||
        point[0] === arrow.points[index - 1][0] ||
        point[1] === arrow.points[index - 1][1],
    ),
  );
  assert.deepEqual(arrow.startBinding, byId.get("e").startBinding);
  assert.deepEqual(arrow.endBinding, byId.get("e").endBinding);
  const rotated = saved.elements.find((element) => element.id === "rotated");
  const first = rotated.points[0];
  const last = rotated.points.at(-1);
  assert.ok(Math.abs(rotated.x + first[0] - 50) < 0.001);
  assert.ok(Math.abs(rotated.y + first[1] - 350) < 0.001);
  assert.ok(Math.abs(rotated.x + last[0] - 50) < 0.001);
  assert.ok(Math.abs(rotated.y + last[1] - 450) < 0.001);
  const original = await call("read_checkpoint", { id: created.checkpointId });
  assert.deepEqual(original.elements, source.elements);
  console.log(
    "Container smoke passed: tool discovery, create_view, native routing, atomic node rename, rotated conversion, immutable source checkpoint.",
  );
} finally {
  await client.close();
}
