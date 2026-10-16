import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { reviewedObligation } from "../../../src/application/ReconstructionObligationLedger.fixture.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";

const execute = promisify(execFile);

/** Run the ledger command, returning the JSON body from success or failure. */
const runLedgerCli = async (
  input: unknown,
): Promise<Record<string, unknown>> => {
  const fail = (cause: unknown): never => {
    throw cause;
  };
  try {
    const { stdout } = await execute(
      process.execPath,
      [
        "scripts/rea.mjs",
        "build-reconstruction-obligation-ledger",
        JSON.stringify(input),
        "--json",
      ],
      { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
    );
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (cause: unknown) {
    if (
      !(cause instanceof Error) ||
      !("stdout" in cause) ||
      typeof cause.stdout !== "string"
    )
      return fail(cause);
    return JSON.parse(cause.stdout) as Record<string, unknown>;
  }
};

/** Caller-input mistakes that must be reported as invalid requests. */
const ledgerRejectionCases = (
  canonical: ReturnType<typeof createEvidenceBundle>,
) => {
  const base = {
    evidence_bundle: canonical,
    reviewed_obligations: [],
    manifest: { bindings: [], contradictions: [] },
  };
  return [
    {
      input: {
        ...base,
        reviewed_obligations: [
          reviewedObligation("obl.review.missing", "ev_" + "a".repeat(64)),
        ],
      },
      message: "Reviewed obligation Evidence is missing",
    },
    {
      input: {
        ...base,
        evidence_bundle: {
          ...canonical,
          records: [...canonical.records, canonical.records[0]],
        },
      },
      message: "Evidence bundle contains duplicate record IDs",
    },
  ];
};

describe("reconstruction obligation ledger CLI parity", () => {
  it("reports non-canonical authenticated bundles as caller input", async () => {
    const records = ["first", "second"].map((label) =>
      createEvidence(
        undefined,
        { id: "fixture", name: "Fixture", version: "1" },
        {
          operation: "observe",
          parameters: { label },
          result: { label },
        },
      ),
    );
    const canonical = createEvidenceBundle(records);
    const input = {
      evidence_bundle: canonical,
      reviewed_obligations: [],
      manifest: { bindings: [], contradictions: [] },
    };
    const accepted = await execute(
      process.execPath,
      [
        "scripts/rea.mjs",
        "build-reconstruction-obligation-ledger",
        JSON.stringify(input),
        "--json",
      ],
      { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
    );
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      normalized_result: { status: "unknown", summary: { total: 0 } },
    });
    input.evidence_bundle = {
      ...canonical,
      records: [...canonical.records].reverse(),
    };
    let stdout: string;
    try {
      await execute(
        process.execPath,
        [
          "scripts/rea.mjs",
          "build-reconstruction-obligation-ledger",
          JSON.stringify(input),
          "--json",
        ],
        { cwd: process.cwd(), env: process.env, maxBuffer: 16 * 1_024 * 1_024 },
      );
      throw new Error("Expected non-canonical bundle input to fail");
    } catch (cause: unknown) {
      if (
        !(cause instanceof Error) ||
        !("stdout" in cause) ||
        typeof cause.stdout !== "string"
      )
        throw cause;
      stdout = cause.stdout;
    }
    expect(JSON.parse(stdout)).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: true,
      details: {
        operation: "build_reconstruction_obligation_ledger",
        issues: [
          expect.objectContaining({
            message: expect.stringContaining(
              "Evidence bundle manifests are not canonical",
            ),
          }),
        ],
      },
    });
  }, 20_000);

  it("reports ledger caller-input mistakes as invalid requests", async () => {
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: { label: "present" },
        result: { label: "present" },
      },
    );
    for (const { input, message } of ledgerRejectionCases(
      createEvidenceBundle([record]),
    )) {
      expect(await runLedgerCli(input)).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        retryable: true,
        details: {
          operation: "build_reconstruction_obligation_ledger",
          issues: [
            expect.objectContaining({
              message: expect.stringContaining(message),
            }),
          ],
        },
      });
    }
  }, 30_000);

  it("builds the same Evidence-backed empty ledger through the CLI", async () => {
    const input = {
      evidence_bundle: createEvidenceBundle([]),
      reviewed_obligations: [],
      manifest: {
        bindings: [],
        contradictions: [],
      },
    };
    const { stdout } = await execute(
      process.execPath,
      [
        "scripts/rea.mjs",
        "build-reconstruction-obligation-ledger",
        JSON.stringify(input),
        "--json",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 16 * 1_024 * 1_024,
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      operation: "build_reconstruction_obligation_ledger",
      predicate_type: "rea.reconstruction-obligation-ledger",
      normalized_result: {
        schema: "ReconstructionObligationLedger",
        status: "unknown",
        summary: { total: 0 },
      },
    });
  }, 20_000);
});
