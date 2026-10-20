import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { nativeCallObservationInputSchema } from "../../../../src/domain/native/nativeCallObservation.js";
import { ok } from "../../../../src/domain/result.js";
import { LldbCallTracer } from "../../../../src/native/LldbCallTracer.js";
import type { NativeCallTracer } from "../../../../src/native/LldbCallTracer.js";
import {
  ProviderProcessSupervisor,
  type ProviderProcessSnapshot,
} from "../../../../src/process/ProviderProcess.js";

const request: Parameters<NativeCallTracer["trace"]>[0] = {
  executable: "/tmp/fixture",
  architecture: "arm64",
  expectedSha256: "a".repeat(64),
  input: nativeCallObservationInputSchema.parse({
    breakpoints: [{ kind: "function", name: "main" }],
    arguments: ["--fixture"],
    environment: { CASE: "physical-bridge-failure" },
  }),
};

const fakeTool = { path: "/usr/bin/lldb", sha256: "b".repeat(64) };

const fakeLldbPeer = (): string => `#!${process.execPath}
const { readFileSync, writeFileSync } = require("node:fs");
const command = process.argv.at(-1);
const configPath = /^rea_trace (.+)$/u.exec(command)?.[1];
if (configPath === undefined) process.exit(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
writeFileSync(config.observation_path, "");
writeFileSync(config.stdout_capture_path, "bridge stdout");
writeFileSync(config.stderr_capture_path, "");
writeFileSync(
  config.result_path,
  JSON.stringify({
    status: "target-error",
    error: "fixture physical bridge failure",
    target_process_created: false,
  }),
);
process.exit(17);
`;

const stoppedExits: (number | null | undefined)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  stoppedExits.length = 0;
});

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("LLDB cleanup keeps an already observed bridge failure", () => {
  it.skipIf(process.platform !== "darwin")(
    "returns the bridge target-error when cancellation arrives during process cleanup",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "rea-lldb-physical-"));
      onTestFinishedCleanup(root);
      const peer = join(root, "lldb-peer");
      await writeFile(peer, fakeLldbPeer());
      await chmod(peer, 0o700);

      const controller = new AbortController();
      const reason = { caller: "cleanup-barrier" };
      const original = ProviderProcessSupervisor.prototype.stop;
      let held = false;
      vi.spyOn(ProviderProcessSupervisor.prototype, "stop").mockImplementation(
        async function (this: ProviderProcessSupervisor) {
          if (!held) {
            held = true;
            for (let attempt = 0; attempt < 500; attempt += 1) {
              const snapshot: ProviderProcessSnapshot = this.snapshot();
              if (typeof snapshot.exitCode === "number") break;
              await tick(10);
            }
            stoppedExits.push(this.snapshot().exitCode);
            controller.abort(reason);
          }
          return original.call(this);
        },
      );

      const tracer = new LldbCallTracer({}, undefined, async () =>
        ok({ ...fakeTool, path: peer }),
      );
      try {
        const result = await tracer.trace(request, controller.signal);
        expect(stoppedExits).toEqual([17]);
        if (result.ok) throw new Error("expected the physical bridge failure");
        expect(projectAnalysisError(result.error).code).toBe(
          "capability_unavailable",
        );
        expect(result.error).toMatchObject({
          _tag: "AnalysisCapabilityUnavailableError",
          reason: expect.stringContaining("fixture physical bridge failure"),
        });
        expect(JSON.stringify(result.error.cleanup ?? {})).not.toContain(
          "native-target:unknown",
        );
      } finally {
        await tracer.close();
      }
    },
    30000,
  );
});

const onTestFinishedCleanup = (root: string): void => {
  process.on("exit", () => {
    void rm(root, { recursive: true, force: true });
  });
};
