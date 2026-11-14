import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { RustBinaryProvider } from "../../../src/rust/RustBinaryProvider.js";
import {
  createRustImage,
  createRustHashOverflowImage,
} from "../../fixtures/rust/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("reports a recoverable compiler prefix without refusing the dependency report", async () => {
  const root = await createTestTempDirectory("rea-rust-hash-budget-");
  const path = join(root, "many-hashes.elf");
  await writeFile(path, createRustHashOverflowImage());
  const result = await new RustBinaryProvider().inspect({ path });
  if (!result.ok) throw result.error;
  expect(result.value.rustc_commit?.coverage).toMatchObject({
    reason: "max_rustc_hashes",
    effective_limit: 64,
  });
  expect(result.value.auditable_metadata?.packages).toHaveLength(2);
  expect(result.value.limitations).toContainEqual(
    expect.stringContaining("--max-rustc-hashes"),
  );
});

it("reports the cause that bounds the compiler prefix it publishes", async () => {
  // The reader records why it stopped collecting hashes. When the complete-report allowance
  // shortens that list afterwards, the reader's own cause no longer bounds what is published, so
  // the report must describe the allowance that does — and must not advise raising
  // max_rustc_hashes, which the same report says cannot help.
  const root = await createTestTempDirectory("rea-rust-report-bytes-cause-");
  const path = join(root, "many-hashes.elf");
  await writeFile(path, createRustHashOverflowImage());
  const provider = new RustBinaryProvider();
  const at = async (output_bytes: number) => {
    const result = await provider.inspect({
      path,
      producer_limits: { output_bytes },
    });
    if (!result.ok) throw result.error;
    return result.value;
  };

  const shortened = await at(4546);
  expect(shortened.rustc_commit?.coverage).toMatchObject({
    reason: "report_bytes",
    effective_limit: 4546,
  });
  expect(shortened.rustc_commit?.hashes.length ?? 0).toBeGreaterThan(0);
  expect(shortened.rustc_commit?.hashes.length ?? 0).toBeLessThan(64);
  expect(shortened.limitations.join("\n")).not.toMatch(
    /reached max_rustc_hashes=\d+|Increase max_rustc_hashes on the next/u,
  );
  expect(shortened.limitations.join("\n")).toMatch(
    /producer_limits\.output_bytes/u,
  );

  // Raising max_rustc_hashes cannot add hashes to an allowance-shortened list.
  const raised = await provider.inspect({
    path,
    producer_limits: { output_bytes: 4546 },
    max_rustc_hashes: 1000,
  });
  if (!raised.ok) throw raised.error;
  expect(raised.value.rustc_commit?.hashes.length).toBe(
    shortened.rustc_commit?.hashes.length,
  );

  // The text published is the text the sizing counted: no budget is overrun, and every
  // shortened report names the allowance that bounds it.
  for (let budget = 2400; budget <= 6800; budget += 200) {
    const report = await at(budget);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(
      budget,
    );
    if (report.rustc_commit === null) continue;
    expect(report.limitations.join("\n")).not.toMatch(
      /reached max_rustc_hashes=\d+|Increase max_rustc_hashes on the next/u,
    );
  }
});

it("recovers the same complete Rust image after input and report budget changes", async () => {
  const root = await createTestTempDirectory("rea-rust-input-budget-");
  const path = join(root, "selected.elf");
  await writeFile(path, createRustImage({ format: "elf" }));
  const provider = new RustBinaryProvider();
  try {
    const smallInput = await provider.inspect({
      path,
      producer_limits: { input_bytes: 4095 },
    });
    if (smallInput.ok) throw new Error("Expected input admission refusal");
    const projectedInput = projectAnalysisError(smallInput.error);
    expect(projectedInput).toMatchObject({
      code: "resource_constraint",
      details: { reported_limits: { maximum_input_bytes: 4095 } },
    });
    expect(projectedInput.remediation.action).toContain(
      "producer_limits.input_bytes",
    );
    const smallReport = await provider.inspect({
      path,
      producer_limits: { input_bytes: 4096, output_bytes: 16 },
    });
    if (smallReport.ok) throw new Error("Expected report admission refusal");
    const projectedReport = projectAnalysisError(smallReport.error);
    expect(projectedReport).toMatchObject({
      code: "resource_constraint",
      details: { reported_limits: { maximum_output_bytes: 16 } },
    });
    expect(projectedReport.remediation.action).toContain(
      "producer_limits.output_bytes",
    );
    const recovered = await provider.inspect({
      path,
      producer_limits: { input_bytes: 4096, output_bytes: 16384 },
    });
    if (!recovered.ok) throw recovered.error;
    expect(recovered.value.auditable_metadata?.packages).toHaveLength(2);
    expect(recovered.value.artifact.bytes).toBe(4096);
  } finally {
    await provider.close();
  }
});
