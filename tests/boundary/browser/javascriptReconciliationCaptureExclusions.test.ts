import { describe, expect, it } from "vitest";

import { createJavaScriptRuntimeObservationEvidence } from "../../../src/application/javascript/JavaScriptRuntimeObservationEvidence.js";
import { finalizeInspectorCapture } from "../../../src/inspector/V8InspectorCaptureProjection.js";
import { V8_INSPECTOR_PROVIDER_IDENTITY } from "../../../src/inspector/providerIdentity.js";
import { parseRuntimeCaptures } from "../../../src/domain/javascript/javascriptRuntimeReconciliationCaptureParsing.js";

const input = {
  inspector_endpoint: "http://127.0.0.1:9222",
  target_id: "fixture",
  observation_ms: 0,
};

const inspectorEvidence = async (
  invalidScripts: number,
  excluded?: {
    readonly unsupported_location: number;
    readonly invalid_protocol_value: number;
  },
) => {
  const result = await finalizeInspectorCapture({
    input,
    runtime: {
      product: "Node.js fixture",
      protocol_version: "1.3",
      v8_version: null,
    },
    target: {
      id: "fixture",
      type: "node",
      attached: false,
      location: { kind: "builtin", specifier: "node:fixture" },
      webSocketUrl: "ws://127.0.0.1:9222/fixture",
      url: "node:fixture",
    },
    state: {
      scripts: [],
      contexts: new Map(),
      eventsObserved: invalidScripts,
      eventsRetained: invalidScripts,
      eventsDropped: 0,
      metadataBytes: 0,
      scriptsObserved: 0,
      invalidScripts,
      truncated: false,
      truncationReasons: new Set(),
    },
  });
  const observation =
    excluded === undefined
      ? result
      : { ...result, scripts: { ...result.scripts, excluded } };
  const evidence = createJavaScriptRuntimeObservationEvidence(
    "observe_javascript_runtime",
    input,
    observation,
    V8_INSPECTOR_PROVIDER_IDENTITY,
  );
  const [parsed] = parseRuntimeCaptures([evidence]);
  if (parsed === undefined || parsed.kind !== "v8-inspector")
    throw new Error("expected a v8-inspector capture");
  return { result, completeness: parsed.inspection.completeness };
};

describe("V8 reconciliation capture exclusion reasons", () => {
  it("keeps a zero-event capture free of script exclusions", async () => {
    const { completeness } = await inspectorEvidence(0);
    expect(completeness.excluded).toEqual([]);
    expect(completeness.policy_filtered_sections).toEqual([]);
  });

  it("preserves invalid protocol values instead of claiming target scope", async () => {
    const { result, completeness } = await inspectorEvidence(3);
    expect(result.scripts.excluded).toEqual({
      unsupported_location: 0,
      invalid_protocol_value: 3,
    });
    expect(completeness.excluded).toEqual([
      { section: "scripts", reason: "invalid_protocol_value", count: 3 },
    ]);
    expect(completeness.policy_filtered_sections).toEqual(["scripts"]);
  });

  it("reports each producer exclusion reason with its own count", async () => {
    const { completeness } = await inspectorEvidence(2, {
      unsupported_location: 1,
      invalid_protocol_value: 2,
    });
    expect(completeness.excluded).toEqual(
      expect.arrayContaining([
        { section: "scripts", reason: "out_of_target_scope", count: 1 },
        { section: "scripts", reason: "invalid_protocol_value", count: 2 },
      ]),
    );
    expect(completeness.excluded).toHaveLength(2);
  });
});
