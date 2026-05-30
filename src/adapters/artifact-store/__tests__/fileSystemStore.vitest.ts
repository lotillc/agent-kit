import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { FileSystemArtifactStore } from "../fileSystemStore.js";

describe("FileSystemArtifactStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "fs-artifact-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("write then read returns the same value", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await store.write("plan", '{"hello":"world"}');
    expect(await store.read("plan")).toBe('{"hello":"world"}');
  });

  test("read of a missing key returns null", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    expect(await store.read("missing")).toBeNull();
  });

  test("exists reflects presence", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    expect(await store.exists("k")).toBe(false);
    await store.write("k", "v");
    expect(await store.exists("k")).toBe(true);
  });

  test("delete removes the file; idempotent on missing", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await store.write("k", "v");
    await store.delete("k");
    expect(await store.exists("k")).toBe(false);
    // Second delete must not throw — matches port semantics for an absent key.
    await store.delete("k");
  });

  test("nested keys create intermediate directories", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await store.write("run-1/plan", "p");
    await store.write("run-1/spec", "s");
    expect(await store.read("run-1/plan")).toBe("p");
    expect(await store.read("run-1/spec")).toBe("s");
  });

  test("rootDir is created lazily on first write", async () => {
    const nested = join(root, "lazy", "deep");
    const store = new FileSystemArtifactStore({ rootDir: nested });
    expect(await store.exists("k")).toBe(false);
    await store.write("k", "v");
    expect(await store.read("k")).toBe("v");
  });

  test("rejects empty key", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await expect(store.write("", "v")).rejects.toThrow(/non-empty/);
  });

  test("rejects absolute keys", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await expect(store.write("/etc/passwd", "v")).rejects.toThrow(/relative/);
  });

  test("rejects keys that escape rootDir via ..", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await expect(store.write("../escape", "v")).rejects.toThrow(/escapes rootDir/);
    await expect(store.read("../escape")).rejects.toThrow(/escapes rootDir/);
  });

  test("rejects keys containing a NUL byte", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await expect(store.write("a\0b", "v")).rejects.toThrow(/NUL/);
    await expect(store.read("a\0b")).rejects.toThrow(/NUL/);
  });

  test("stores files as <key>.json under rootDir", async () => {
    const store = new FileSystemArtifactStore({ rootDir: root });
    await store.write("plan", "x");
    // Confirm the on-disk layout — consumers may stat files directly when
    // composing with tools that watch the artifact directory.
    expect(await readFile(join(root, "plan.json"), "utf8")).toBe("x");
  });
});
