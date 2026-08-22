import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Maximum serialized checkpoint size (5 MB). */
const MAX_CHECKPOINT_BYTES = 5 * 1024 * 1024;

/** Maximum number of checkpoints kept on disk before pruning oldest. */
const MAX_FILE_CHECKPOINTS = 100;

const REDIS_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Validates that a checkpoint ID is safe to use as a filename.
 * Rejects path traversal attempts and other filesystem-unsafe characters.
 */
function validateCheckpointId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(
      `Invalid checkpoint id: must be alphanumeric, hyphens, or underscores`,
    );
  }
  if (id.length > 64) {
    throw new Error(`Invalid checkpoint id: exceeds 64 character limit`);
  }
}

export type CheckpointParent = {
  checkpointId: string;
  revision: string;
};

export type CheckpointData = {
  elements: any[];
  revision?: string;
  parent?: CheckpointParent;
  remote?: {
    name: string;
    revision: string;
    document: {
      type: string;
      version?: number;
      source?: string;
      appState: Record<string, unknown>;
      files: Record<string, unknown>;
    };
  };
};

export type SaveDerivedCheckpointOptions = {
  sourceId: string;
  expectedSourceRevision: string;
  targetId: string;
  data: CheckpointData;
};

export type CheckpointStoreErrorCode =
  | "SOURCE_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "TARGET_EXISTS";

export class CheckpointStoreError extends Error {
  readonly code: CheckpointStoreErrorCode;

  constructor(code: CheckpointStoreErrorCode, message: string) {
    super(message);
    this.name = "CheckpointStoreError";
    this.code = code;
  }
}

function canonicalize(
  value: unknown,
  ancestors: Set<object>,
): string | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (typeof value === "bigint") {
    throw new TypeError("Cannot canonicalize a BigInt value");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Cannot canonicalize a circular checkpoint");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item) => canonicalize(item, ancestors) ?? "null")
        .join(",")}]`;
    }

    const entries = Object.keys(value)
      .sort()
      .flatMap((key) => {
        const serialized = canonicalize(
          (value as Record<string, unknown>)[key],
          ancestors,
        );
        return serialized === undefined
          ? []
          : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Returns the stable SHA-256 revision for checkpoint content and ancestry. */
export function computeCheckpointRevision(data: CheckpointData): string {
  const { revision: _revision, ...content } = data;
  const serializedContent = JSON.stringify(content);
  if (serializedContent === undefined) {
    throw new TypeError("Checkpoint data is not serializable");
  }
  const canonical = canonicalize(JSON.parse(serializedContent), new Set());
  if (canonical === undefined) {
    throw new TypeError("Checkpoint data is not serializable");
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const computeCanonicalCheckpointRevision = computeCheckpointRevision;

function serializeCheckpoint(data: CheckpointData): string {
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CHECKPOINT_BYTES) {
    throw new Error(
      `Checkpoint data exceeds ${MAX_CHECKPOINT_BYTES} byte limit`,
    );
  }
  return serialized;
}

function parseCheckpoint(raw: string): CheckpointData | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function prepareDerivedCheckpoint(
  sourceId: string,
  sourceRevision: string,
  data: CheckpointData,
): CheckpointData {
  const withoutRevision: CheckpointData = {
    ...data,
    parent: {
      checkpointId: sourceId,
      revision: sourceRevision,
    },
  };
  delete withoutRevision.revision;
  return {
    ...withoutRevision,
    revision: computeCheckpointRevision(withoutRevision),
  };
}

function assertSourceRevision(
  source: CheckpointData | null,
  expectedRevision: string,
): string {
  if (!source) {
    throw new CheckpointStoreError(
      "SOURCE_NOT_FOUND",
      "Source checkpoint does not exist",
    );
  }
  const actualRevision = computeCheckpointRevision(source);
  if (actualRevision !== expectedRevision) {
    throw new CheckpointStoreError(
      "REVISION_CONFLICT",
      `Source checkpoint revision conflict: expected ${expectedRevision}, got ${actualRevision}`,
    );
  }
  return actualRevision;
}

export interface CheckpointStore {
  save(id: string, data: CheckpointData): Promise<void>;
  load(id: string): Promise<CheckpointData | null>;
  saveDerived(options: SaveDerivedCheckpointOptions): Promise<CheckpointData>;
}

export class FileCheckpointStore implements CheckpointStore {
  private dir: string;

  constructor() {
    this.dir = path.join(os.tmpdir(), "excalidraw-mcp-checkpoints");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async save(id: string, data: CheckpointData): Promise<void> {
    validateCheckpointId(id);
    const serialized = serializeCheckpoint(data);
    await this.withLocks([id], async () => {
      await this.writeAtomically(id, serialized);
    });
    await this.pruneOldCheckpoints([id]);
  }

  async load(id: string): Promise<CheckpointData | null> {
    validateCheckpointId(id);
    const filePath = this.getFilePath(id);
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      return parseCheckpoint(raw);
    } catch {
      return null;
    }
  }

  async saveDerived(
    options: SaveDerivedCheckpointOptions,
  ): Promise<CheckpointData> {
    const { sourceId, expectedSourceRevision, targetId, data } = options;
    validateCheckpointId(sourceId);
    validateCheckpointId(targetId);
    if (sourceId === targetId) {
      throw new CheckpointStoreError(
        "TARGET_EXISTS",
        "Derived checkpoint must use a new target id",
      );
    }

    let derived!: CheckpointData;
    await this.withLocks([sourceId, targetId], async () => {
      const source = await this.load(sourceId);
      const sourceRevision = assertSourceRevision(
        source,
        expectedSourceRevision,
      );
      if (await this.fileExists(this.getFilePath(targetId))) {
        throw new CheckpointStoreError(
          "TARGET_EXISTS",
          `Target checkpoint ${targetId} already exists`,
        );
      }
      derived = prepareDerivedCheckpoint(sourceId, sourceRevision, data);
      await this.writeAtomically(targetId, serializeCheckpoint(derived));
    });
    await this.pruneOldCheckpoints([sourceId, targetId]);
    return derived;
  }

  private getFilePath(id: string): string {
    const filePath = path.join(this.dir, `${id}.json`);
    if (!path.resolve(filePath).startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error("Invalid checkpoint path");
    }
    return filePath;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async writeAtomically(id: string, serialized: string): Promise<void> {
    const filePath = this.getFilePath(id);
    const tempPath = path.join(this.dir, `.${id}.${randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(tempPath, serialized, {
        encoding: "utf8",
        flag: "wx",
      });
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  private async withLocks<T>(
    ids: string[],
    action: () => Promise<T>,
  ): Promise<T> {
    const lockPaths = [...new Set(ids)]
      .sort()
      .map((id) => path.join(this.dir, `.${id}.lock`));
    const handles: fs.promises.FileHandle[] = [];
    try {
      for (const lockPath of lockPaths) {
        handles.push(await this.acquireLock(lockPath));
      }
      return await action();
    } finally {
      await Promise.all(
        handles.map(async (handle, index) => {
          await handle.close().catch(() => {});
          await fs.promises.unlink(lockPaths[index]).catch(() => {});
        }),
      );
    }
  }

  private async acquireLock(lockPath: string): Promise<fs.promises.FileHandle> {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        return await fs.promises.open(lockPath, "wx");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST" ||
          Date.now() >= deadline
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  /** Remove oldest checkpoints when count exceeds the limit. */
  private async pruneOldCheckpoints(
    protectedIds: string[] = [],
  ): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.dir);
      const jsonFiles = entries.filter((file) => file.endsWith(".json"));
      if (jsonFiles.length <= MAX_FILE_CHECKPOINTS) {
        return;
      }

      const stats = await Promise.all(
        jsonFiles.map(async (file) => ({
          name: file,
          mtime: (await fs.promises.stat(path.join(this.dir, file))).mtimeMs,
        })),
      );
      stats.sort((first, second) => first.mtime - second.mtime);
      const protectedFiles = new Set(protectedIds.map((id) => `${id}.json`));
      const toRemove = stats
        .filter((file) => !protectedFiles.has(file.name))
        .slice(0, stats.length - MAX_FILE_CHECKPOINTS);
      await Promise.all(
        toRemove.map((file) =>
          fs.promises.unlink(path.join(this.dir, file.name)).catch(() => {}),
        ),
      );
    } catch {
      // Best-effort cleanup; don't fail the save
    }
  }
}

const memoryStore = new Map<string, string>();

function pruneMemoryStore(protectedIds: string[] = []): void {
  if (memoryStore.size <= MAX_FILE_CHECKPOINTS) {
    return;
  }
  const protectedKeys = new Set(protectedIds);
  for (const key of memoryStore.keys()) {
    if (!protectedKeys.has(key)) {
      memoryStore.delete(key);
      return;
    }
  }
}

export class MemoryCheckpointStore implements CheckpointStore {
  async save(id: string, data: CheckpointData): Promise<void> {
    validateCheckpointId(id);
    memoryStore.set(id, serializeCheckpoint(data));
    pruneMemoryStore([id]);
  }

  async load(id: string): Promise<CheckpointData | null> {
    validateCheckpointId(id);
    const raw = memoryStore.get(id);
    return raw ? parseCheckpoint(raw) : null;
  }

  async saveDerived(
    options: SaveDerivedCheckpointOptions,
  ): Promise<CheckpointData> {
    const { sourceId, expectedSourceRevision, targetId, data } = options;
    validateCheckpointId(sourceId);
    validateCheckpointId(targetId);
    if (memoryStore.has(targetId)) {
      throw new CheckpointStoreError(
        "TARGET_EXISTS",
        `Target checkpoint ${targetId} already exists`,
      );
    }
    const source = parseCheckpoint(memoryStore.get(sourceId) ?? "");
    const sourceRevision = assertSourceRevision(source, expectedSourceRevision);
    const derived = prepareDerivedCheckpoint(sourceId, sourceRevision, data);
    const serialized = serializeCheckpoint(derived);
    if (memoryStore.has(targetId)) {
      throw new CheckpointStoreError(
        "TARGET_EXISTS",
        `Target checkpoint ${targetId} already exists`,
      );
    }
    memoryStore.set(targetId, serialized);
    pruneMemoryStore([sourceId, targetId]);
    return derived;
  }
}

export class RedisCheckpointStore implements CheckpointStore {
  private redis: any = null;

  private async getRedis() {
    if (!this.redis) {
      const { Redis } = await import("@upstash/redis");
      const url =
        process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
      const token =
        process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) {
        throw new Error(
          "Missing Redis env vars (KV_REST_API_* or UPSTASH_REDIS_REST_*)",
        );
      }
      this.redis = new Redis({ url, token });
    }
    return this.redis;
  }

  async save(id: string, data: CheckpointData): Promise<void> {
    validateCheckpointId(id);
    const serialized = serializeCheckpoint(data);
    const redis = await this.getRedis();
    await redis.set(`cp:${id}`, serialized, { ex: REDIS_TTL_SECONDS });
  }

  async load(id: string): Promise<CheckpointData | null> {
    validateCheckpointId(id);
    const redis = await this.getRedis();
    const raw = await redis.get(`cp:${id}`);
    if (!raw) {
      return null;
    }
    return typeof raw === "string" ? parseCheckpoint(raw) : raw;
  }

  async saveDerived(
    options: SaveDerivedCheckpointOptions,
  ): Promise<CheckpointData> {
    const { sourceId, expectedSourceRevision, targetId, data } = options;
    validateCheckpointId(sourceId);
    validateCheckpointId(targetId);
    if (sourceId === targetId) {
      throw new CheckpointStoreError(
        "TARGET_EXISTS",
        "Derived checkpoint must use a new target id",
      );
    }

    const redis = await this.getRedis();
    const sourceRaw = await redis.get(`cp:${sourceId}`);
    const source = sourceRaw
      ? typeof sourceRaw === "string"
        ? parseCheckpoint(sourceRaw)
        : sourceRaw
      : null;
    const sourceRevision = assertSourceRevision(source, expectedSourceRevision);
    const derived = prepareDerivedCheckpoint(sourceId, sourceRevision, data);
    const serialized = serializeCheckpoint(derived);
    const expectedRaw =
      typeof sourceRaw === "string" ? sourceRaw : JSON.stringify(sourceRaw);

    const result = await redis.eval(
      `
        local source = redis.call("GET", KEYS[1])
        if not source then return "SOURCE_NOT_FOUND" end
        if source ~= ARGV[1] then return "REVISION_CONFLICT" end
        if redis.call("EXISTS", KEYS[2]) == 1 then return "TARGET_EXISTS" end
        redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
        return "OK"
      `,
      [`cp:${sourceId}`, `cp:${targetId}`],
      [expectedRaw, serialized, REDIS_TTL_SECONDS],
    );

    if (result === "SOURCE_NOT_FOUND") {
      throw new CheckpointStoreError(
        "SOURCE_NOT_FOUND",
        "Source checkpoint does not exist",
      );
    }
    if (result === "REVISION_CONFLICT") {
      throw new CheckpointStoreError(
        "REVISION_CONFLICT",
        "Source checkpoint changed during derived save",
      );
    }
    if (result === "TARGET_EXISTS") {
      throw new CheckpointStoreError(
        "TARGET_EXISTS",
        `Target checkpoint ${targetId} already exists`,
      );
    }
    if (result !== "OK") {
      throw new Error(
        `Unexpected Redis derived save result: ${String(result)}`,
      );
    }
    return derived;
  }
}

export function createVercelStore(): CheckpointStore {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    return new RedisCheckpointStore();
  }
  return new MemoryCheckpointStore();
}
