import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { evmInterfaceFailure } from "../../../src/evm/EvmoleFailures.js";
import { EVM_INTERFACE_LIMITS } from "../../../src/evm/EvmoleRelease.js";

it("maps a selected-artifact reader limit to a file-size resource constraint", () => {
  const failure = evmInterfaceFailure(
    new ArtifactReaderFailure(
      "limit",
      `Selected artifact exceeds ${String(EVM_INTERFACE_LIMITS.inputBytes)} bytes: /selected.hex`,
    ),
    "artifact-read",
    "/selected.hex",
  );
  expect(failure).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    operation: "inspect_evm_interface",
    resource: "file-size",
    reportedLimits: { maximum_input_bytes: EVM_INTERFACE_LIMITS.inputBytes },
    message: expect.stringContaining(String(EVM_INTERFACE_LIMITS.inputBytes)),
  });
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "resource_constraint",
    details: {
      operation: "inspect_evm_interface",
      resource: "file-size",
      reported_limits: {
        maximum_input_bytes: EVM_INTERFACE_LIMITS.inputBytes,
      },
    },
  });
});

it.each(["format", "path"] as const)(
  "keeps non-limit %s reader failures as caller input errors",
  (reason) => {
    const failure = evmInterfaceFailure(
      new ArtifactReaderFailure(
        reason,
        reason === "format"
          ? "Artifact stream did not return bytes: /selected.hex"
          : "Expected a regular file without a symlink: /selected.hex",
      ),
      "artifact-read",
      "/selected.hex",
    );
    expect(failure).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [{ path: ["path"], reason: "invalid_format" }],
    });
  },
);
