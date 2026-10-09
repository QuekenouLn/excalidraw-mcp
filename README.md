# Excalidraw MCP App Server

MCP server that streams hand-drawn Excalidraw diagrams with smooth viewport camera control and interactive fullscreen editing.

![Demo](docs/demo.gif)

## Single-element editing

Use `select_scene_elements` with an ID (or a few IDs) to obtain the scene revision and element versions, then call `edit_scene_element`. No full scene query is needed in the agent context.

- `changes` updates one node's position, size or style, or one arrow's style / `startArrowhead` / `endArrowhead`.
- `text` updates the target's bound label.
- `replaceWithCard: {text, styleFrom?}` converts one unbound Markdown Frame to a native rectangle and bound text, retaining its ID, position, dimensions and stacking order. `styleFrom` is a rectangle's `{id, version, versionNonce}`. Oversized text fails instead of enlarging the card.
- Only the target and its own bound text may change by default. Moving a connected node can require arrow updates; list only those permitted IDs in `allowedElementIds`. Otherwise the transaction fails before creating a checkpoint.

```json
{
  "checkpointId": "CURRENT_CHECKPOINT",
  "expectedRevision": "CURRENT_SCENE_REVISION",
  "target": {"id": "ARROW_ID", "version": 7, "versionNonce": 123},
  "changes": {"endArrowhead": "triangle"}
}
```

Call with `excalidraw-agent-cli call edit_scene_element --input request.json`, inspect the returned affected IDs and field diff, then use `save_remote_file` with the latest remote file revision. The server still loads and saves complete checkpoints internally; only selected elements and edit diffs are returned to the agent. Existing `apply_scene_operations` also accepts `allowedElementIds` to bound a batch operation's effects.

`create_view` with `restoreCheckpoint` now converts only additions. Restored elements retain user positioning and alignment; adding one card does not recenter existing arrow labels.

## Install

Works with any client that supports [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) — Claude, ChatGPT, VS Code, Goose, and others. If something doesn't work, please [open an issue](https://github.com/antonpk1/excalidraw-mcp-app/issues).

### Remote (recommended)

### `https://mcp.excalidraw.com`

For apps that don't yet have an official integration, you can add a custom MCP / connector (naming can vary between apps).

### Local

**Option A: Download Extension**

1. Download `excalidraw-mcp-app.mcpb` from [Releases](https://github.com/antonpk1/excalidraw-mcp-app/releases)
2. Double-click to install in Claude Desktop

**Option B: Build from Source**

This fork bundles native geometry from its matching parent Excalidraw checkout. Build from the monorepo (with Node.js, Corepack and Bun available):

```bash
# From the Excalidraw monorepo root
git submodule update --init integrations/excalidraw-mcp
yarn install --frozen-lockfile
cd integrations/excalidraw-mcp
pnpm install --frozen-lockfile
pnpm run build
```

The root Yarn dependencies resolve the native geometry's transitive imports; the MCP pnpm dependencies build the server and widget. A standalone checkout of this fork cannot build without the parent sources. The bundled `dist` output runs without the monorepo or its `node_modules`. See the parent repository's [repair plan and validation](../../docs/excalidraw-mcp-native-elbow-repair.md).

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/path/to/excalidraw-mcp-app/dist/index.js", "--stdio"]
    }
  }
}
```

Restart Claude Desktop.

## Usage

Example prompts:

- "Draw a cute cat using excalidraw"
- "Draw an architecture diagram showing a user connecting to an API server which talks to a database"

## What are MCP Apps and how can I build one?

Text responses can only go so far. Sometimes users need to interact with data, not just read about it. [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/) is an official Model Context Protocol extension that lets servers return interactive HTML interfaces (data visualizations, forms, dashboards) that render directly in the chat.

- **Getting started for humans**: [documentation](https://modelcontextprotocol.io/docs/extensions/apps)
- **Getting started for AIs**: [skill](https://github.com/modelcontextprotocol/ext-apps/blob/main/plugins/mcp-apps/skills/create-mcp-app/SKILL.md)

## Contributing

PRs welcome! See [Local](#local) above for build instructions.

### Deploy your own instance

The supported container build for this fork runs from the parent monorepo:

```bash
docker compose build excalidraw-mcp
```

It uses `deploy/excalidraw-mcp.Dockerfile` with the repository root as context, installs both locked dependency sets, and copies only `dist` into the runtime image. Building does not replace an existing container. After deployment is approved, recreate only this service with `docker compose up -d --no-deps excalidraw-mcp` and reconnect the client to refresh tool discovery. Preserve the checkpoint volume.

Standalone Vercel source deployment requires providing the same parent sources and dependencies; the upstream one-click deployment does not satisfy this fork's native geometry dependency.

### Release checklist

<details>
<summary>For maintainers</summary>

```bash
# 1. Bump version in manifest.json and package.json
# 2. Build and pack
pnpm run build && mcpb pack .

# 3. Create GitHub release
gh release create v0.3.0 excalidraw-mcp-app.mcpb --title "v0.3.0" --notes "What changed"

# 4. Deploy using the parent monorepo container workflow above
```

</details>

## Credits

Built with [Excalidraw](https://github.com/excalidraw/excalidraw) — a virtual whiteboard for sketching hand-drawn like diagrams.

## License

MIT
