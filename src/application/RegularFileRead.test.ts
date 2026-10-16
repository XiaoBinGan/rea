import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { withRegularFile } from "./RegularFileRead.js";

describe("regular-file read cancellation", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  const fixture = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "rea-regular-file-cancel-"));
    roots.push(root);
    const path = join(root, "fixture.txt");
    await writeFile(path, "fixture bytes");
    return path;
  };

  it("observes cancellation that arrives during final metadata validation", async () => {
    const path = await fixture();
    const controller = new AbortController();
    const reason = new Error("fixture cancellation during final metadata");
    let finalStats = 0;
    let captured: FileHandle | undefined;
    await expect(
      withRegularFile(
        path,
        async (handle) => {
          captured = handle;
          const originalStat = handle.stat.bind(handle);
          const patched = async (...args: unknown[]): Promise<Stats> => {
            finalStats += 1;
            const metadata = await (
              originalStat as (...inner: unknown[]) => Promise<Stats>
            )(...args);
            controller.abort(reason);
            return metadata;
          };
          (handle as unknown as { stat: typeof patched }).stat = patched;
          return handle.readFile({ encoding: "utf8" });
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(finalStats).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    // The owned descriptor still closes after the cancellation.
    expect(captured?.fd).toBe(-1);
  });

  it("still reads an uncancelled file", async () => {
    const path = await fixture();
    await expect(
      withRegularFile(path, (handle) => handle.readFile({ encoding: "utf8" })),
    ).resolves.toBe("fixture bytes");
  });
});
