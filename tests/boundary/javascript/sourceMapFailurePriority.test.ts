import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, it, vi } from "vitest";

import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { runSourceMapCommand } from "../../../src/javascript/sourceMaps/SourceMapCommand.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

const helper = (): string => `#!${process.execPath}
const { spawn } = require("node:child_process");
process.stderr.write("physical exit 7");
// A short-lived descendant inherits the diagnostic pipe, so output stays open
// after the codec itself has exited.
spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], {
  stdio: ["ignore", "ignore", 2],
});
process.exit(7);
`;

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

it("keeps an observed codec exit through a cancellation while output drains", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-source-map-exit-"));
  roots.push(root);
  const script = join(root, "codec");
  await writeFile(script, helper());
  await chmod(script, 0o700);

  const controller = new AbortController();
  const reason = { caller: "drain-barrier" };
  let observed: { code: number | null; signal: string | null } | undefined;
  const original = ProviderProcessSupervisor.prototype.waitForOutputClose;
  vi.spyOn(
    ProviderProcessSupervisor.prototype,
    "waitForOutputClose",
  ).mockImplementation(async function (this: ProviderProcessSupervisor, ms) {
    if (observed === undefined) {
      const exit = this.observedExit();
      if (exit !== undefined) {
        observed = exit;
        controller.abort(reason);
      }
    }
    return original.call(this, ms);
  });
  try {
    const result = await runSourceMapCommand(
      "{}",
      "/selected.map",
      { signal: controller.signal },
      {
        prepareOwnership: async () => {},
        launcher: async (options) =>
          spawnOwnedProviderProcess({
            ...options,
            command: process.execPath,
            arguments: [script],
          }),
      },
    );
    expect(observed).toEqual({ code: 7, signal: null });
    if (result.ok) throw new Error("the codec failure was reported as success");
    expect(result.error).toBeInstanceOf(ProviderAdapterError);
    expect(result.error.diagnostics).toMatchObject({
      map_path: "/selected.map",
      exit_code: 7,
    });
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    vi.restoreAllMocks();
  }
}, 60000);

it("keeps the exact caller abort reason on a pre-aborted source-map request", async () => {
  const controller = new AbortController();
  const reason = { caller: "pre-aborted" };
  controller.abort(reason);
  const result = await runSourceMapCommand(
    "{}",
    "/selected.map",
    { signal: controller.signal },
    {
      prepareOwnership: async (signal) => {
        signal?.throwIfAborted();
      },
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a cancellation");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
});

it("keeps cancelling a successful codec run that drains after finalization", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-source-map-success-"));
  roots.push(root);
  const script = join(root, "codec");
  await writeFile(
    script,
    `#!${process.execPath}
const { spawn } = require("node:child_process");
process.stdout.write("{}");
spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], {
  stdio: ["ignore", 1, "ignore"],
});
process.exit(0);
`,
  );
  await chmod(script, 0o700);

  const controller = new AbortController();
  const reason = { caller: "success-finalization" };
  let aborted = false;
  const original = ProviderProcessSupervisor.prototype.waitForOutputClose;
  vi.spyOn(
    ProviderProcessSupervisor.prototype,
    "waitForOutputClose",
  ).mockImplementation(async function (this: ProviderProcessSupervisor, ms) {
    if (!aborted) {
      const exit = this.observedExit();
      if (exit !== undefined) {
        aborted = true;
        controller.abort(reason);
      }
    }
    return original.call(this, ms);
  });
  try {
    const result = await runSourceMapCommand(
      "{}",
      "/selected.map",
      { signal: controller.signal },
      {
        prepareOwnership: async () => {},
        launcher: async (options) =>
          spawnOwnedProviderProcess({
            ...options,
            command: process.execPath,
            arguments: [script],
          }),
      },
    );
    expect(aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error("a cancelled success must not return output");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
  } finally {
    vi.restoreAllMocks();
  }
}, 60000);
