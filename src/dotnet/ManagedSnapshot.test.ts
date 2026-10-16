import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { hashManagedSource, readManagedSnapshot } from "./ManagedSnapshot.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const sparseFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "rea-managed-snapshot-"));
  roots.push(root);
  const path = join(root, "owned.bin");
  const file = await open(path, "wx+");
  await file.truncate(32 * 1024 * 1024);
  await file.close();
  return path;
};

/** Abort the controller after the first data event of the next managed stream. */
const abortAfterFirstData = (
  proto: { createReadStream: (...args: unknown[]) => unknown },
  controller: AbortController,
): (() => void) => {
  const original = proto.createReadStream;
  proto.createReadStream = function (this: unknown, ...args: unknown[]) {
    const stream = original.apply(this, args) as {
      once(event: "data", listener: () => void): unknown;
    };
    stream.once("data", () => {
      setImmediate(() => controller.abort());
    });
    return stream;
  };
  return () => {
    proto.createReadStream = original;
  };
};

describe("managed snapshot hashing", () => {
  it("hashes a sparse owned file without cancellation", async () => {
    const path = await sparseFixture();
    const expected = createHash("sha256")
      .update(Buffer.alloc(32 * 1024 * 1024))
      .digest("hex");
    await expect(
      hashManagedSource(path, "inspect_managed_artifact"),
    ).resolves.toEqual({ byteLength: 32 * 1024 * 1024, sha256: expected });
  });

  it("keeps its typed cancellation and completes cleanup when the stream is aborted", async () => {
    const path = await sparseFixture();
    const controller = new AbortController();
    const resources = new ArtifactResourceScope();
    const file = await open(path, "r");
    const proto = Object.getPrototypeOf(file) as {
      createReadStream: (...args: unknown[]) => unknown;
    };
    const restore = abortAfterFirstData(proto, controller);
    await file.close();
    try {
      await expect(
        hashManagedSource(path, "inspect_managed_artifact", {
          signal: controller.signal,
          resources,
        }),
      ).rejects.toBeInstanceOf(AnalysisCancelledError);
    } finally {
      restore();
    }
    expect(controller.signal.aborted).toBe(true);
    expect(resources.hasPending).toBe(false);
    await expect(resources.retryCleanup()).resolves.toBeUndefined();
    await expect(resources.close()).resolves.toBeUndefined();
  });

  it("rejects a pre-aborted read with the typed cancellation", async () => {
    const path = await sparseFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      readManagedSnapshot(path, "inspect_managed_artifact", {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AnalysisCancelledError);
  });
});
