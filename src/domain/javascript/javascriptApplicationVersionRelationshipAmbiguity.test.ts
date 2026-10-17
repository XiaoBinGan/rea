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

const LEFT_ARTIFACT = "1".repeat(64);
const RIGHT_ARTIFACT = "2".repeat(64);
const LEFT_SHA = "a".repeat(64);
const RIGHT_SHA = "b".repeat(64);

interface VersionSpec {
  readonly artifactSha: string;
  /** Source digest shared by both peer modules, or one digest per peer. */
  readonly peerDigests: readonly [string, string];
  /** Which peer module the main module imports. */
  readonly importedPeer: 0 | 1;
}

const PATHS = ["main.js", "p0.js", "p1.js"] as const;

const buildGraph = (spec: VersionSpec): JavaScriptApplicationGraph => {
  const digests = ["d".repeat(64), spec.peerDigests[0], spec.peerDigests[1]];
  const nodes = PATHS.map((path, index) =>
    createJavaScriptApplicationNode({
      kind: "javascript-module",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: spec.artifactSha,
        path,
      },
      observations: [
        {
          label: path,
          properties: { source_sha256: digests[index] ?? "0".repeat(64) },
          evidence: artifactEvidence(spec.artifactSha, path),
        },
      ],
    }),
  );
  const idOf = (index: number): string => {
    const node = nodes[index];
    if (node === undefined) throw new Error(`Missing fixture node ${index}`);
    return node.node_id;
  };
  return createJavaScriptApplicationGraph({
    schema: "JavaScriptApplicationGraph",
    root_node_ids: [idOf(0)],
    nodes,
    edges: [
      createJavaScriptApplicationEdge({
        source_node_id: idOf(0),
        target_node_id: idOf(spec.importedPeer + 1),
        relation: "imports",
        properties: {},
        evidence: artifactEvidence(spec.artifactSha, PATHS[0]),
      }),
    ],
    coverage: completeCoverage,
    limitations: [],
  });
};

const compare = (left: VersionSpec, right: VersionSpec) =>
  compareJavaScriptApplicationVersions({
    left: {
      evidenceId: `ev_${"3".repeat(64)}`,
      rootArtifactSha256: LEFT_SHA,
      graph: buildGraph(left),
    },
    right: {
      evidenceId: `ev_${"4".repeat(64)}`,
      rootArtifactSha256: RIGHT_SHA,
      graph: buildGraph(right),
    },
    leftNativeEvidence: [],
    rightNativeEvidence: [],
  });

const mainItem = (
  result: ReturnType<typeof compare>,
  left: VersionSpec,
): ReturnType<typeof compare>["items"][number] => {
  const id = buildGraph(left).root_node_ids[0];
  const item = result.items.find(({ left_node_id: leftId }) => leftId === id);
  if (item === undefined) throw new Error("Missing main module item");
  return item;
};

const AMBIGUOUS_PEERS = ["c".repeat(64), "c".repeat(64)] as const;
const UNIQUE_PEERS = ["c".repeat(64), "e".repeat(64)] as const;

describe("application version relationship ambiguity", () => {
  it("leaves an importer unknown when its imported peer has only ambiguous candidates", () => {
    const left: VersionSpec = {
      artifactSha: LEFT_ARTIFACT,
      peerDigests: AMBIGUOUS_PEERS,
      importedPeer: 0,
    };
    const result = compare(left, {
      artifactSha: RIGHT_ARTIFACT,
      peerDigests: AMBIGUOUS_PEERS,
      importedPeer: 0,
    });

    const item = mainItem(result, left);
    expect(item.status).toBe("unknown");
    expect(item.dimensions).toContain("relationships");
    expect(
      item.limitations.some((limitation) =>
        limitation.includes("multiple permitted cross-version candidates"),
      ),
    ).toBe(true);
    // The exact content match is retained, and the four ambiguous peers stay
    // unknown; only the importer changes from a false `unchanged` to `unknown`.
    expect(result.summary).toEqual({
      unchanged: 0,
      added: 0,
      removed: 0,
      changed: 0,
      unknown: 5,
    });
  });

  it("keeps an importer unchanged when its imported peer matches uniquely", () => {
    const left: VersionSpec = {
      artifactSha: LEFT_ARTIFACT,
      peerDigests: UNIQUE_PEERS,
      importedPeer: 0,
    };
    const result = compare(left, {
      artifactSha: RIGHT_ARTIFACT,
      peerDigests: UNIQUE_PEERS,
      importedPeer: 0,
    });

    const item = mainItem(result, left);
    expect(item.status).toBe("unchanged");
    expect(item.dimensions).toEqual([]);
    expect(result.summary).toEqual({
      unchanged: 3,
      added: 0,
      removed: 0,
      changed: 0,
      unknown: 0,
    });
  });

  it("still reports a resolved import target change as changed", () => {
    const left: VersionSpec = {
      artifactSha: LEFT_ARTIFACT,
      peerDigests: UNIQUE_PEERS,
      importedPeer: 0,
    };
    const result = compare(left, {
      artifactSha: RIGHT_ARTIFACT,
      peerDigests: UNIQUE_PEERS,
      importedPeer: 1,
    });

    const item = mainItem(result, left);
    expect(item.status).toBe("changed");
    expect(item.dimensions).toEqual(["relationships"]);
  });
});
