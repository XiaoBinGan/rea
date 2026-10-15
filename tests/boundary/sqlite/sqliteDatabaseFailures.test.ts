import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { sqliteDatabaseFailure } from "../../../src/sqlite/SqliteDatabaseFailures.js";
import { SQLITE_DATABASE_LIMITS } from "../../../src/sqlite/SqliteDatabaseLimits.js";

it("maps a selected-artifact reader limit to a file-size resource constraint", () => {
  const failure = sqliteDatabaseFailure(
    new ArtifactReaderFailure(
      "limit",
      `Selected artifact exceeds ${String(SQLITE_DATABASE_LIMITS.inputBytes)} bytes: /selected.db`,
    ),
    "/selected.db",
    "artifact-read",
  );
  expect(failure).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    operation: "inspect_sqlite_database",
    resource: "file-size",
    reportedLimits: { maximum_input_bytes: SQLITE_DATABASE_LIMITS.inputBytes },
    message: expect.stringContaining(String(SQLITE_DATABASE_LIMITS.inputBytes)),
  });
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "resource_constraint",
    details: {
      operation: "inspect_sqlite_database",
      resource: "file-size",
      reported_limits: {
        maximum_input_bytes: SQLITE_DATABASE_LIMITS.inputBytes,
      },
    },
  });
});

it("keeps non-limit reader failures as caller input errors", () => {
  const failure = sqliteDatabaseFailure(
    new ArtifactReaderFailure(
      "format",
      "Artifact stream did not return bytes: /selected.db",
    ),
    "/selected.db",
    "artifact-read",
  );
  expect(failure).toMatchObject({
    _tag: "AnalysisInputError",
    issues: [{ path: ["path"], reason: "invalid_format" }],
  });
});
