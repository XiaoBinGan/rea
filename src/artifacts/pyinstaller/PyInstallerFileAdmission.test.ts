import { describe, expect, it } from "vitest";

import {
  NonRegularFileReadError,
  RegularFileAdmissionFailure,
  RegularFileChangedError,
  RegularFileOperationCancelled,
} from "../../filesystem/RegularFile.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { translateArtifactFailure } from "../ArtifactOperationFailure.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { pyInstallerFileAdmissionFailure } from "./PyInstallerFileAdmission.js";

const selected = "/selected/app";

const classify = (cause: unknown): ArtifactReaderFailure =>
  pyInstallerFileAdmissionFailure(selected, cause);

describe("PyInstaller admission classification", () => {
  it("keeps an observed source-identity change as integrity", () => {
    const changed = new RegularFileChangedError(selected);
    const failure = classify(changed);

    expect(failure).toBeInstanceOf(ArtifactReaderFailure);
    expect(failure.reason).toBe("integrity");
    expect(failure.message).toContain("changed during admission");
    expect(failure.cause).toBe(changed);
  });

  it("projects the identity change as integrity_mismatch for extract_artifact", () => {
    const failure = classify(new RegularFileChangedError(selected));
    const projected = projectAnalysisError(
      translateArtifactFailure("extract_artifact", failure),
    );

    // Same reason and category the reader's own post-read source check reports.
    expect(projected).toMatchObject({
      category: "integrity_mismatch",
      retryable: false,
      details: {
        operation: "extract_artifact",
        reason: "integrity",
        detail: expect.stringContaining("changed during admission"),
      },
    });
  });

  it("keeps an unknown admission failure the generic io refusal", () => {
    const failure = classify(new Error("EIO: i/o error"));

    expect(failure.reason).toBe("io");
    expect(failure.message).toBe("PyInstaller archive could not be opened");
    expect(
      projectAnalysisError(
        translateArtifactFailure("extract_artifact", failure),
      ),
    ).toMatchObject({
      code: "artifact_operation_failed",
      category: "execution_failure",
      details: { reason: "io" },
    });
  });

  it("keeps a non-regular selection a format refusal", () => {
    expect(classify(new NonRegularFileReadError(selected, true)).reason).toBe(
      "format",
    );
  });

  it("keeps cancellation a cancelled refusal with the caller reason", () => {
    const reason = { caller: "test" };
    const failure = classify(new RegularFileOperationCancelled(reason));

    expect(failure.reason).toBe("cancelled");
    expect(failure.cancellation).toEqual({ reason });
  });

  it("returns an existing artifact failure unchanged", () => {
    const existing = new ArtifactReaderFailure("limit", "too large");
    expect(classify(existing)).toBe(existing);
  });

  it("keeps the identity reason through a retained cleanup failure", () => {
    const changed = new RegularFileChangedError(selected);
    const failure = classify(
      new RegularFileAdmissionFailure(
        selected,
        changed,
        new Error("close failed"),
        new OwnedFileHandle({ fd: -1 } as never),
      ),
    );

    expect(failure.reason).toBe("integrity");
    expect(failure.cleanup).toMatchObject({ resources: [selected] });
  });
});
