import { describe, expect, it } from "vitest";

import { createBrowserEvidence } from "../../../src/application/BrowserEvidence.js";
import {
  analyzeWebBundleInputSchema,
  webBundleAnalysisSchema,
} from "../../../src/domain/webBundleAnalysis.js";

const PROVIDER = {
  id: "fixture",
  name: "Fixture analysis provider",
  version: "1",
} as const;
const ORIGIN = "https://capture.example.test";
const ENDPOINT = "http://127.0.0.1:9222";

const bundleResult = () =>
  webBundleAnalysisSchema.parse({
    capture: {
      target_url: `${ORIGIN}/page`,
      scripts_observed: 1,
      scripts_analyzed: 1,
      source_artifacts: [],
    },
    observations: {
      chunks: { nodes: [], edges: [] },
      routes: [],
      endpoints: [],
      webmcp_declarations: [],
      source_maps: {
        status: "not_requested",
        requested: 0,
        processed: 0,
        items: [],
      },
    },
    inferences: [],
    unknowns: [],
    completeness: {
      status: "complete",
      parsed_scripts: 1,
      parse_failures: 0,
      visited_ast_nodes: 0,
    },
    limitations: [],
  });

const bundleEvidence = (allowedOrigins: readonly string[]) =>
  createBrowserEvidence(
    "analyze_web_bundle",
    analyzeWebBundleInputSchema.parse({
      cdp_endpoint: ENDPOINT,
      allowed_origins: allowedOrigins,
      target_id: "page",
    }),
    bundleResult(),
    PROVIDER,
  );

describe("bundle analysis Evidence origin scope", () => {
  it("retains the effective default origin the provider applied", () => {
    // The provider scopes an omitted origin list to the selected target origin.
    expect(bundleEvidence([]).parameters).toMatchObject({
      cdp_endpoint: ENDPOINT,
      allowed_origins: [ORIGIN],
      target_id: "page",
    });
    // An explicit caller scope is preserved unchanged.
    expect(
      bundleEvidence(["https://caller.example.test"]).parameters,
    ).toMatchObject({ allowed_origins: ["https://caller.example.test"] });
  });
});
