import { describe, expect, it } from "vitest";

import { observeWebSessionInputSchema } from "../../../src/domain/browserSession.js";
import { projectInputIssues } from "../../../src/domain/inputIssueProjection.js";

describe("observe_web_session observation window", () => {
  const input = (observation_ms: number) => ({
    cdp_endpoint: "http://127.0.0.1:9222",
    allowed_origins: ["https://capture.example.test"],
    target_id: "target",
    observation_ms,
  });

  it("rejects an observation window that Node cannot time", () => {
    // The largest delay Node honors exactly stays accepted.
    expect(
      observeWebSessionInputSchema.safeParse(input(2_147_483_647)).success,
    ).toBe(true);
    const result = observeWebSessionInputSchema.safeParse(input(2_147_483_648));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "too_big",
        path: ["observation_ms"],
        maximum: 2_147_483_647,
      }),
    );
    // Callers receive the same typed correction the execution tool reports.
    expect(
      projectInputIssues(result.error.issues, input(2_147_483_648)),
    ).toContainEqual({
      path: ["observation_ms"],
      reason: "out_of_range",
      maximum: 2_147_483_647,
    });
  });
});
