import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, it } from "vitest";

import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A worker peer that completes the handshake and then fails after the request. */
const peer = (): string => `#!${process.execPath}
process.stdout.write(
  JSON.stringify({ kind: "ready", heap_limit_bytes: 134217728 }) + "\\n",
);
process.stdin.once("data", () => {
  process.stderr.write("worker physical exit 7");
  process.exit(7);
});
`;

const source = (value: string): JavaScriptArtifactFile => ({
  path: "fixture.mjs",
  sha256: createHash("sha256").update(value).digest("hex"),
  container_sha256: "1".repeat(64),
  bytes: Buffer.byteLength(value),
  inventory_artifact_id: "fixture-source",
  kind: "javascript",
  unpacked: false,
  text: { included: true, value },
});

const analyzeWithPeer = async (
  abort: "never" | "after-exit",
): Promise<{ tag: string; cause?: unknown }> => {
  const root = await mkdtemp(join(tmpdir(), "rea-js-worker-exit-"));
  roots.push(root);
  const script = join(root, "worker-peer");
  await writeFile(script, peer());
  await chmod(script, 0o700);

  const controller = new AbortController();
  const reason = { caller: "after-exit-barrier" };
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const spawned = await spawnOwnedProviderProcess({
        ...request,
        arguments: [script],
      });
      if (abort === "after-exit")
        spawned.process.once("exit", () => {
          setImmediate(() => controller.abort(reason));
        });
      return spawned;
    },
  );
  try {
    const result = await worker.analyze(
      source("export const observed = 7;"),
      { nodes: 100, unknowns: 100 },
      abort === "after-exit" ? controller.signal : undefined,
    );
    if (result.ok) throw new Error("the peer failure was reported as success");
    return {
      tag: (result.error.error as { _tag?: string })._tag ?? "unknown",
      cause: result.error.error,
    };
  } finally {
    await worker.close().catch(() => undefined);
  }
};

it("keeps an observed worker exit when cancellation arrives after it", async () => {
  const aborted = await analyzeWithPeer("after-exit");
  expect(aborted.cause).toBeInstanceOf(ProviderAdapterError);
  expect((aborted.cause as ProviderAdapterError).diagnostics).toMatchObject({
    source_path: "fixture.mjs",
    exit_code: 7,
  });
}, 60000);

it("reports the same worker exit without any cancellation", async () => {
  const control = await analyzeWithPeer("never");
  expect(control.cause).toBeInstanceOf(ProviderAdapterError);
  expect((control.cause as ProviderAdapterError).diagnostics).toMatchObject({
    exit_code: 7,
  });
}, 60000);

it("keeps cancelling a worker the caller aborts before any exit is observed", async () => {
  const controller = new AbortController();
  const reason = { caller: "pre-aborted" };
  controller.abort(reason);
  const worker = new JavaScriptAnalysisWorker({
    heapMb: 128,
    timeoutMs: 30_000,
  });
  try {
    const result = await worker.analyze(
      source("export const observed = 7;"),
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a cancellation");
    expect(result.error.error).toBeInstanceOf(AnalysisCancelledError);
  } finally {
    await worker.close().catch(() => undefined);
  }
}, 60000);
