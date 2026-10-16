import { describe, expect, it } from "vitest";

import {
  createJavaScriptApplicationEdge,
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
  type JavaScriptApplicationGraph,
} from "./javascriptApplicationGraph.js";
import {
  artifactEvidence,
  completeCoverage,
} from "./javascriptApplicationGraph.fixture.js";
import { compareJavaScriptApplicationVersions } from "./javascriptApplicationVersionComparison.js";
import { applicationVersionComparisonResultSchema } from "./javascriptApplicationVersionComparisonSchemas.js";

const LEFT_SHA = "a".repeat(64);
const RIGHT_SHA = "b".repeat(64);

/**
 * Bundle whose module `a` keeps its identity and content while its byte
 * range inside the bundle moves, the shift every earlier edit produces.
 */
const buildGraph = (
  artifactSha: string,
  sourceSha: string,
  aByteStart: number,
): JavaScriptApplicationGraph => {
  const nodes = ["a", "b", "c"].map((name) =>
    createJavaScriptApplicationNode({
      kind: "javascript-module",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: artifactSha,
        path: `${name}.js`,
      },
      observations: [
        {
          label: `${name}.js`,
          properties: {
            structural_fingerprint_sha256: name
              .charCodeAt(0)
              .toString(16)
              .padStart(64, "0"),
            structural_fingerprint_algorithm: "fixture",
            source_sha256: name === "a" ? sourceSha : "0".repeat(64),
          },
          evidence: artifactEvidence(artifactSha, `${name}.js`),
        },
        {
          label: `${name}.js#bundle`,
          properties: { bundle: "main.js" },
          evidence: {
            ...artifactEvidence(artifactSha, `${name}.js`),
            location: {
              available: true,
              value: {
                kind: "file-offset-range",
                start: name === "a" ? aByteStart : 0,
                end: name === "a" ? aByteStart + 50 : 50,
              },
            },
          },
        },
      ],
    }),
  );
  const [a, b, c] = nodes;
  if (a === undefined || b === undefined || c === undefined)
    throw new Error("Missing fixture node");
  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [a.node_id],
    nodes,
    edges: [
      createJavaScriptApplicationEdge({
        source_node_id: a.node_id,
        target_node_id: b.node_id,
        relation: "imports",
        properties: {},
        evidence: artifactEvidence(artifactSha, "a.js"),
      }),
      createJavaScriptApplicationEdge({
        source_node_id: b.node_id,
        target_node_id: c.node_id,
        relation: "imports",
        properties: {},
        evidence: artifactEvidence(artifactSha, "b.js"),
      }),
    ],
    coverage: completeCoverage,
    limitations: [],
  });
};

const compare = (
  leftGraph: JavaScriptApplicationGraph,
  rightGraph: JavaScriptApplicationGraph,
) => {
  return applicationVersionComparisonResultSchema.parse(
    compareJavaScriptApplicationVersions({
      left: {
        evidenceId: `ev_${"1".repeat(64)}`,
        rootArtifactSha256: LEFT_SHA,
        graph: leftGraph,
      },
      right: {
        evidenceId: `ev_${"2".repeat(64)}`,
        rootArtifactSha256: RIGHT_SHA,
        graph: rightGraph,
      },
      leftNativeEvidence: [],
      rightNativeEvidence: [],
    }),
  );
};

const itemsOf = (result: ReturnType<typeof compare>) =>
  result.items.filter(({ node_kind }) => node_kind === "javascript-module");

describe("version comparison location-only pairs", () => {
  it("classifies a pair whose bytes moved but content did not as unchanged", () => {
    const result = compare(
      buildGraph(LEFT_SHA, "0".repeat(64), 100),
      buildGraph(RIGHT_SHA, "0".repeat(64), 200),
    );
    const shifted = itemsOf(result).filter(
      ({ status }) => status === "unchanged",
    );
    expect(shifted).toHaveLength(3);
    expect(
      itemsOf(result).every(({ dimensions }) =>
        dimensions.every((dimension) => dimension !== "content"),
      ),
    ).toBe(true);
    expect(result.summary.changed).toBe(0);
    expect(result.summary.unchanged).toBeGreaterThanOrEqual(3);
  });

  it("still classifies a source-content difference as changed", () => {
    const result = compare(
      buildGraph(LEFT_SHA, "0".repeat(64), 100),
      buildGraph(RIGHT_SHA, "1".repeat(64), 100),
    );
    expect(itemsOf(result)).toContainEqual(
      expect.objectContaining({
        status: "changed",
        dimensions: expect.arrayContaining(["content"]),
      }),
    );
    expect(result.summary.changed).toBeGreaterThanOrEqual(1);
  });
});
