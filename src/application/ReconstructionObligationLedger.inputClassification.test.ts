import { describe, expect, it } from "vitest";

import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { AnalysisProtocolError } from "../domain/analysisErrorCore.js";
import { createEvidence } from "../domain/evidence.js";
import { createEvidenceBundle } from "../domain/evidenceBundle.js";
import { buildReconstructionObligationLedgerEvidenceValidated } from "./ReconstructionObligationLedgerService.js";
import { reviewedObligation } from "./ReconstructionObligationLedger.fixture.js";

const inputBase = (
  evidence_bundle: ReturnType<typeof createEvidenceBundle>,
) => ({
  evidence_bundle,
  reviewed_obligations: [],
  manifest: { bindings: [], contradictions: [] },
});

describe("reconstruction obligation ledger input classification", () => {
  it("reports a reviewed evidence id missing from the bundle as caller input", () => {
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: { label: "present" },
        result: { label: "present" },
      },
    );
    const missing = "ev_" + "a".repeat(64);
    const result = buildReconstructionObligationLedgerEvidenceValidated({
      ...inputBase(createEvidenceBundle([record])),
      reviewed_obligations: [reviewedObligation("obl.review.missing", missing)],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    if (!(result.error instanceof AnalysisInputError)) return;
    expect(result.error.issues).toEqual([
      {
        path: [],
        reason: "invalid_value",
        message: expect.stringContaining(
          "Reviewed obligation Evidence is missing",
        ),
      },
    ]);
  });

  it("reports an Evidence bundle with duplicate record IDs as caller input", () => {
    const record = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "observe",
        parameters: { label: "duplicated" },
        result: { label: "duplicated" },
      },
    );
    const canonical = createEvidenceBundle([record]);
    const result = buildReconstructionObligationLedgerEvidenceValidated({
      ...inputBase(canonical),
      evidence_bundle: {
        ...canonical,
        records: [...canonical.records, canonical.records[0]!],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisInputError);
    expect(result.error).not.toBeInstanceOf(AnalysisProtocolError);
    if (!(result.error instanceof AnalysisInputError)) return;
    expect(result.error.issues).toEqual([
      {
        path: [],
        reason: "invalid_value",
        message: "Evidence bundle contains duplicate record IDs",
      },
    ]);
  });
});
