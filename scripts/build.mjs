#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, renameSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const nativeSource = join(root, "../../packages/element/src/elbowArrow.ts");
if (!existsSync(nativeSource)) {
  throw new Error(
    "This MCP fork requires the matching Excalidraw monorepo checkout. " +
      "Initialize integrations/excalidraw-mcp in that checkout and install both " +
      "the root Yarn and MCP pnpm dependencies before building. " +
      "See docs/excalidraw-mcp-native-elbow-repair.md in the parent repository.",
  );
}

function run(cmd, env = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

rmSync(join(root, "dist"), { recursive: true, force: true });

// 1. Type-check
run("tsc --noEmit");

// 2. Vite build (singlefile HTML)
run("vite build");

// 3. Move the HTML output to dist root (cross-platform)
renameSync(
  join(root, "dist", "src", "mcp-app.html"),
  join(root, "dist", "mcp-app.html"),
);
rmSync(join(root, "dist", "src"), { recursive: true, force: true });

// 4. Build server types
run("tsc -p tsconfig.server.json");

// 5. Bundle server + index
const nativeEnv = `--define 'import.meta.env.PROD=true' --define 'import.meta.env.DEV=false' --define 'import.meta.env.MODE="production"'`;
run(`bun build "src/server.ts" --outdir dist --target node ${nativeEnv}`);
run(
  `bun build "src/main.ts" --outfile "dist/index.js" --target node --banner "#!/usr/bin/env node" ${nativeEnv}`,
);
