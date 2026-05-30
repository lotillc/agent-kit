import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { ArtifactStore } from "../../ports/ArtifactStore.js";

export interface FileSystemArtifactStoreOptions {
  /** Root directory under which `<key>.json` files are stored. Created on demand. */
  rootDir: string;
}

// Each key becomes `<rootDir>/<key>.json`; `/` nests dirs. Lexical guard
// blocks `..` traversal; assumes single-tenant `rootDir` (no symlink-race defense).
export class FileSystemArtifactStore implements ArtifactStore {
  private readonly rootDir: string;

  constructor(options: FileSystemArtifactStoreOptions) {
    this.rootDir = resolve(options.rootDir);
  }

  async read(key: string): Promise<string | null> {
    const path = this.resolveKey(key);
    try {
      return await readFile(path, "utf8");
    } catch (err) {
      if (isNodeErrnoException(err) && err.code === "ENOENT") return null;
      throw err;
    }
  }

  async write(key: string, value: string): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    // Write to a temp file in the same dir, then atomically rename into place so
    // a crash mid-write can't leave truncated JSON that fails a later loadState().
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, value, "utf8");
    try {
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const path = this.resolveKey(key);
    try {
      await access(path);
      return true;
    } catch (err) {
      if (isNodeErrnoException(err) && err.code === "ENOENT") return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key);
    await rm(path, { force: true });
  }

  private resolveKey(key: string): string {
    if (key.length === 0) throw new Error("ArtifactStore key must be non-empty");
    // Reject NUL bytes before `path.resolve` silently embeds them — node:fs
    // would otherwise throw `ERR_INVALID_ARG_VALUE`, which is a worse caller
    // experience than this validation error.
    if (key.includes("\0")) throw new Error("ArtifactStore key must not contain NUL bytes");
    if (isAbsolute(key)) throw new Error(`ArtifactStore key must be relative: ${key}`);
    const fullPath = resolve(this.rootDir, `${key}.json`);
    const rel = relative(this.rootDir, fullPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`ArtifactStore key escapes rootDir: ${key}`);
    }
    return fullPath;
  }
}

const isNodeErrnoException = (err: unknown): err is NodeJS.ErrnoException =>
  err instanceof Error && "code" in err && typeof (err as { code: unknown }).code === "string";
