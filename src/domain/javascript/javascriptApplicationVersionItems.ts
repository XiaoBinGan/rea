import { absenceClaimable, canonicalJson } from "../comparisonSemantics.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { Evidence } from "../evidence.js";
import type {
  ApplicationEdge,
  ApplicationNode,
} from "./javascriptApplicationGraphSchemas.js";
import type { JavaScriptApplicationGraph } from "./javascriptApplicationGraph.js";
import type { ApplicationVersionComparisonItem } from "./javascriptApplicationVersionComparisonSchemas.js";
import type {
  ApplicationVersionMatchingProjection,
  ApplicationVersionNodePair,
} from "./javascriptApplicationVersionKeys.js";

/** All classified entities and their complete ambiguity candidate sets. */
export interface ApplicationVersionItemProjection {
  readonly items: ApplicationVersionComparisonItem[];
}

interface ItemContext {
  readonly leftGraph: JavaScriptApplicationGraph;
  readonly rightGraph: JavaScriptApplicationGraph;
  readonly leftEvidenceId: string;
  readonly rightEvidenceId: string;
  readonly leftNativeEvidenceByDigest: ReadonlyMap<string, readonly string[]>;
  readonly rightNativeEvidenceByDigest: ReadonlyMap<string, readonly string[]>;
  readonly pairByLeft: ReadonlyMap<string, string>;
  readonly pairByRight: ReadonlyMap<string, string>;
  readonly candidatesByLeft: ReadonlyMap<string, readonly string[]>;
  readonly candidatesByRight: ReadonlyMap<string, readonly string[]>;
  readonly leftRelationships: RelationshipIndex;
  readonly rightRelationships: RelationshipIndex;
}

type ItemContextInput = Omit<
  ItemContext,
  | "leftNativeEvidenceByDigest"
  | "rightNativeEvidenceByDigest"
  | "pairByLeft"
  | "pairByRight"
  | "candidatesByLeft"
  | "candidatesByRight"
  | "leftRelationships"
  | "rightRelationships"
> & {
  readonly leftNativeEvidence: readonly Evidence[];
  readonly rightNativeEvidence: readonly Evidence[];
};

interface IndexedRelationship {
  readonly direction: "in" | "out";
  readonly relation: ApplicationEdge["relation"];
  readonly neighborId: string;
}

interface RelationshipIndex {
  readonly nodeById: ReadonlyMap<string, ApplicationNode>;
  readonly adjacency: ReadonlyMap<string, readonly IndexedRelationship[]>;
}

type OneSidedNode =
  | {
      readonly left: ApplicationNode;
      readonly right?: never;
      readonly candidateRightNodeIds: readonly string[];
      readonly candidateLeftNodeIds?: never;
    }
  | {
      readonly left?: never;
      readonly right: ApplicationNode;
      readonly candidateRightNodeIds?: never;
      readonly candidateLeftNodeIds: readonly string[];
    };

type ComparisonItemSemantic<
  Item extends ApplicationVersionComparisonItem =
    ApplicationVersionComparisonItem,
> = Item extends ApplicationVersionComparisonItem
  ? Omit<Item, "item_id">
  : never;

/** Classify matched, unmatched, and ambiguous nodes without inventing absence. */
export const classifyJavaScriptApplicationVersions = (
  matching: ApplicationVersionMatchingProjection,
  context: ItemContextInput,
): ApplicationVersionItemProjection => {
  const pairByLeft = new Map(
    matching.pairs.map(({ left, right }) => [
      left.node_id,
      `pair:${left.node_id}:${right.node_id}`,
    ]),
  );
  const pairByRight = new Map(
    matching.pairs.map(({ left, right }) => [
      right.node_id,
      `pair:${left.node_id}:${right.node_id}`,
    ]),
  );
  const fullContext: ItemContext = {
    leftGraph: context.leftGraph,
    rightGraph: context.rightGraph,
    leftEvidenceId: context.leftEvidenceId,
    rightEvidenceId: context.rightEvidenceId,
    leftNativeEvidenceByDigest: indexNativeEvidence(context.leftNativeEvidence),
    rightNativeEvidenceByDigest: indexNativeEvidence(
      context.rightNativeEvidence,
    ),
    pairByLeft,
    pairByRight,
    candidatesByLeft: matching.candidatesForLeft,
    candidatesByRight: matching.candidatesForRight,
    leftRelationships: indexRelationships(context.leftGraph),
    rightRelationships: indexRelationships(context.rightGraph),
  };
  const leftItems = matching.unmatchedLeft.map((node) => {
    const candidates = matching.candidatesForLeft.get(node.node_id) ?? [];
    return unmatchedItem(
      {
        left: node,
        candidateRightNodeIds: candidates,
      },
      fullContext,
    );
  });
  const rightItems = matching.unmatchedRight.map((node) => {
    const candidates = matching.candidatesForRight.get(node.node_id) ?? [];
    return unmatchedItem(
      {
        right: node,
        candidateLeftNodeIds: candidates,
      },
      fullContext,
    );
  });
  return {
    items: [
      ...matching.pairs.map((pair) => matchedItem(pair, fullContext)),
      ...leftItems,
      ...rightItems,
    ].sort((left, right) =>
      compareUnicodeCodePoints(left.item_id, right.item_id),
    ),
  };
};

const matchedItem = (
  pair: ApplicationVersionNodePair,
  context: ItemContext,
): ApplicationVersionComparisonItem => {
  const { dimensions, relationshipUnresolved } = changedDimensions(
    pair,
    context,
  );
  const complete = graphsComplete(context);
  const observedChange = dimensions.some((dimension) =>
    ["content", "location", "properties"].includes(dimension),
  );
  const status: ApplicationVersionComparisonItem["status"] =
    observedChange ||
    (complete && dimensions.length > 0 && !relationshipUnresolved)
      ? "changed"
      : complete && !relationshipUnresolved
        ? "unchanged"
        : "unknown";
  const finalDimensions =
    status === "unknown" && !complete && !dimensions.includes("coverage")
      ? [...dimensions, "coverage" as const]
      : dimensions;
  const semantic: ComparisonItemSemantic = {
    status,
    node_kind: pair.left.kind,
    left_node_id: pair.left.node_id,
    right_node_id: pair.right.node_id,
    match: matchedMatch(pair),
    dimensions: finalDimensions,
    evidence_links: itemEvidenceLinks(pair.left, pair.right, context),
    limitations: pairLimitations(pair, status, relationshipUnresolved),
  };
  return itemWithId(semantic);
};

const unmatchedItem = (
  member: OneSidedNode,
  context: ItemContext,
): ApplicationVersionComparisonItem =>
  member.left === undefined
    ? rightOnlyItem(member.right, member.candidateLeftNodeIds, context)
    : leftOnlyItem(member.left, member.candidateRightNodeIds, context);

const leftOnlyItem = (
  node: ApplicationNode,
  candidateNodeIds: readonly string[],
  context: ItemContext,
): ApplicationVersionComparisonItem => {
  const [firstCandidate, ...remainingCandidates] = candidateNodeIds;
  const common = {
    node_kind: node.kind,
    evidence_links: itemEvidenceLinks(node, undefined, context),
  };
  if (firstCandidate !== undefined)
    return itemWithId({
      ...common,
      status: "unknown",
      left_node_id: node.node_id,
      right_node_id: null,
      match: {
        status: "ambiguous",
        basis: "none",
        confidence: "unknown",
        candidate_left_node_ids: [],
        candidate_right_node_ids: [firstCandidate, ...remainingCandidates],
      },
      dimensions: ["availability"],
      limitations: [AMBIGUOUS_MATCH_LIMITATION],
    });
  const absenceObserved = absenceClaimable(context.rightGraph.coverage);
  return itemWithId({
    ...common,
    status: absenceObserved ? "removed" : "unknown",
    left_node_id: node.node_id,
    right_node_id: null,
    match: unmatchedMatch(),
    dimensions: absenceObserved
      ? ["availability"]
      : ["availability", "coverage"],
    limitations: absenceObserved ? [] : [INCOMPLETE_GRAPH_LIMITATION],
  });
};

const rightOnlyItem = (
  node: ApplicationNode,
  candidateNodeIds: readonly string[],
  context: ItemContext,
): ApplicationVersionComparisonItem => {
  const [firstCandidate, ...remainingCandidates] = candidateNodeIds;
  const common = {
    node_kind: node.kind,
    evidence_links: itemEvidenceLinks(undefined, node, context),
  };
  if (firstCandidate !== undefined)
    return itemWithId({
      ...common,
      status: "unknown",
      left_node_id: null,
      right_node_id: node.node_id,
      match: {
        status: "ambiguous",
        basis: "none",
        confidence: "unknown",
        candidate_left_node_ids: [firstCandidate, ...remainingCandidates],
        candidate_right_node_ids: [],
      },
      dimensions: ["availability"],
      limitations: [AMBIGUOUS_MATCH_LIMITATION],
    });
  const absenceObserved = absenceClaimable(context.leftGraph.coverage);
  return itemWithId({
    ...common,
    status: absenceObserved ? "added" : "unknown",
    left_node_id: null,
    right_node_id: node.node_id,
    match: unmatchedMatch(),
    dimensions: absenceObserved
      ? ["availability"]
      : ["availability", "coverage"],
    limitations: absenceObserved ? [] : [INCOMPLETE_GRAPH_LIMITATION],
  });
};

const matchedMatch = (
  pair: ApplicationVersionNodePair,
): Extract<
  ApplicationVersionComparisonItem["match"],
  { readonly status: "matched" }
> => {
  const candidates: {
    readonly candidate_left_node_ids: [];
    readonly candidate_right_node_ids: [];
  } = {
    candidate_left_node_ids: [],
    candidate_right_node_ids: [],
  };
  switch (pair.basis) {
    case "exact-node-identity":
    case "exact-content-digest":
    case "exact-module-source-digest":
      return {
        status: "matched",
        basis: pair.basis,
        confidence: "exact",
        ...candidates,
      };
    case "source-map-identity":
      return {
        status: "matched",
        basis: pair.basis,
        confidence: "high",
        ...candidates,
      };
    case "structural-fingerprint":
    case "semantic-key":
      return {
        status: "matched",
        basis: pair.basis,
        confidence: "medium",
        ...candidates,
      };
  }
};

const unmatchedMatch = (): Extract<
  ApplicationVersionComparisonItem["match"],
  { readonly status: "unmatched" }
> => ({
  status: "unmatched",
  basis: "none",
  confidence: "unknown",
  candidate_left_node_ids: [],
  candidate_right_node_ids: [],
});

const AMBIGUOUS_MATCH_LIMITATION =
  "Multiple nodes share the same permitted match key; no cross-version pair was selected.";
const UNRESOLVED_RELATIONSHIP_LIMITATION =
  "A relationship target has multiple permitted cross-version candidates; its alignment is unresolved until adjacent identities are established.";
const INCOMPLETE_GRAPH_LIMITATION =
  "The opposite graph is incomplete, so an unmatched node cannot be classified as added or removed.";

interface ChangedApplicationVersionDimensions {
  readonly dimensions: ApplicationVersionComparisonItem["dimensions"];
  /** A relationship target has no resolved cross-version identity. */
  readonly relationshipUnresolved: boolean;
}

const changedDimensions = (
  pair: ApplicationVersionNodePair,
  context: ItemContext,
): ChangedApplicationVersionDimensions => {
  const dimensions: ApplicationVersionComparisonItem["dimensions"] = [];
  const leftContent = contentIdentity(pair.left);
  const rightContent = contentIdentity(pair.right);
  if (
    leftContent !== null &&
    rightContent !== null &&
    leftContent !== rightContent
  )
    dimensions.push("content");
  if (
    canonicalJson(locations(pair.left)) !== canonicalJson(locations(pair.right))
  )
    dimensions.push("location");
  if (
    canonicalJson(properties(pair.left)) !==
    canonicalJson(properties(pair.right))
  )
    dimensions.push("properties");
  const relationships = compareRelationships(pair, context);
  if (relationships.unresolved || relationships.differing)
    dimensions.push("relationships");
  return {
    dimensions,
    relationshipUnresolved: relationships.unresolved,
  };
};

const contentIdentity = (node: ApplicationNode): string | null => {
  if (node.identity.strategy === "content-digest")
    return `content:${node.identity.sha256}`;
  if (node.kind === "javascript-module")
    return stringProperty(node, "source_sha256");
  if (
    node.kind === "source-module" &&
    node.identity.strategy === "source-map-original"
  )
    return node.identity.source_sha256;
  return null;
};

const locations = (node: ApplicationNode) =>
  node.observations
    .map(({ evidence }) =>
      evidence.location.available ? evidence.location.value : evidence.location,
    )
    .sort((left, right) =>
      compareUnicodeCodePoints(canonicalJson(left), canonicalJson(right)),
    );

const properties = (node: ApplicationNode) =>
  node.observations
    .map(({ label, properties: values, source_map_reference }) => ({
      label,
      properties: values,
      source_map_reference,
    }))
    .sort((left, right) =>
      compareUnicodeCodePoints(canonicalJson(left), canonicalJson(right)),
    );

const indexRelationships = (
  graph: JavaScriptApplicationGraph,
): RelationshipIndex => {
  const adjacency = new Map<string, IndexedRelationship[]>();
  const add = (nodeId: string, relationship: IndexedRelationship): void => {
    const existing = adjacency.get(nodeId);
    if (existing === undefined) adjacency.set(nodeId, [relationship]);
    else existing.push(relationship);
  };
  for (const edge of graph.edges) {
    add(edge.source_node_id, {
      direction: "out",
      relation: edge.relation,
      neighborId: edge.target_node_id,
    });
    if (edge.target_node_id !== edge.source_node_id)
      add(edge.target_node_id, {
        direction: "in",
        relation: edge.relation,
        neighborId: edge.source_node_id,
      });
  }
  return {
    nodeById: new Map(graph.nodes.map((value) => [value.node_id, value])),
    adjacency,
  };
};

interface RelationshipComparison {
  /** At least one neighbor has candidates but no selected cross-version pair. */
  readonly unresolved: boolean;
  readonly differing: boolean;
}

const compareRelationships = (
  pair: ApplicationVersionNodePair,
  context: ItemContext,
): RelationshipComparison => {
  const left = relationshipEdges(pair.left, "left", context);
  const right = relationshipEdges(pair.right, "right", context);
  if (left.unresolved || right.unresolved)
    return { unresolved: true, differing: false };
  return { unresolved: false, differing: left.signature !== right.signature };
};

interface RelationshipEdges {
  readonly signature: string;
  readonly unresolved: boolean;
}

const relationshipEdges = (
  node: ApplicationNode,
  side: "left" | "right",
  context: ItemContext,
): RelationshipEdges => {
  const { nodeById, adjacency } =
    side === "left" ? context.leftRelationships : context.rightRelationships;
  const paired = side === "left" ? context.pairByLeft : context.pairByRight;
  const candidates =
    side === "left" ? context.candidatesByLeft : context.candidatesByRight;
  let unresolved = false;
  const signatures = (adjacency.get(node.node_id) ?? []).map((relationship) => {
    if (
      !paired.has(relationship.neighborId) &&
      (candidates.get(relationship.neighborId)?.length ?? 0) > 0
    )
      unresolved = true;
    return edgeSignature({ ...relationship, paired, nodeById });
  });
  return {
    signature: canonicalJson(signatures.sort(compareUnicodeCodePoints)),
    unresolved,
  };
};

interface EdgeSignatureContext {
  readonly direction: "in" | "out";
  readonly relation: ApplicationEdge["relation"];
  readonly neighborId: string;
  readonly paired: ReadonlyMap<string, string>;
  readonly nodeById: ReadonlyMap<string, ApplicationNode>;
}

const edgeSignature = (context: EdgeSignatureContext): string => {
  const mapped = context.paired.get(context.neighborId);
  const neighbor = context.nodeById.get(context.neighborId);
  return `${context.direction}\0${context.relation}\0${mapped ?? `unmatched:${neighbor?.kind ?? "unknown"}`}`;
};

const itemEvidenceLinks = (
  left: ApplicationNode | undefined,
  right: ApplicationNode | undefined,
  context: ItemContext,
): string[] =>
  [
    ...new Set([
      context.leftEvidenceId,
      context.rightEvidenceId,
      ...nativeLinks(left, context.leftNativeEvidenceByDigest),
      ...nativeLinks(right, context.rightNativeEvidenceByDigest),
    ]),
  ].sort(compareUnicodeCodePoints);

const nativeLinks = (
  node: ApplicationNode | undefined,
  evidenceByDigest: ReadonlyMap<string, readonly string[]>,
): readonly string[] => {
  const identity = node === undefined ? null : contentIdentity(node);
  if (identity === null) return [];
  const digest = identity.replace(/^content:/u, "");
  return evidenceByDigest.get(digest) ?? [];
};

const indexNativeEvidence = (
  evidence: readonly Evidence[],
): ReadonlyMap<string, readonly string[]> => {
  const evidenceByDigest = new Map<string, string[]>();
  for (const { evidence_id: id, subject } of evidence) {
    const digest = subject?.digest.sha256;
    if (digest === undefined) continue;
    const ids = evidenceByDigest.get(digest);
    if (ids === undefined) evidenceByDigest.set(digest, [id]);
    else ids.push(id);
  }
  return evidenceByDigest;
};

const pairLimitations = (
  pair: ApplicationVersionNodePair,
  status: ApplicationVersionComparisonItem["status"],
  relationshipUnresolved: boolean,
): string[] => [
  ...(pair.basis === "structural-fingerprint"
    ? [
        "Structural fingerprint equality is rename-resistant inference; it is not byte identity or proof of semantic equivalence.",
      ]
    : []),
  ...(pair.basis === "source-map-identity"
    ? [
        "Source-map original names identify a candidate source lineage; changed or unavailable source content remains explicit.",
      ]
    : []),
  ...(pair.basis === "semantic-key"
    ? [
        "Semantic-key pairing is a deterministic inference and is never promoted to exact identity.",
      ]
    : []),
  ...(status === "unknown" && !relationshipUnresolved
    ? ["Incomplete graph coverage prevents a complete node-level conclusion."]
    : []),
  ...(relationshipUnresolved ? [UNRESOLVED_RELATIONSHIP_LIMITATION] : []),
];

const itemWithId = <Semantic extends ComparisonItemSemantic>(
  semantic: Semantic,
): Semantic & { readonly item_id: string } => ({
  ...semantic,
  item_id: `javc_item_${digestCanonicalValue(semantic, "Application version item")}`,
});

const stringProperty = (node: ApplicationNode, key: string): string | null => {
  const values = [
    ...new Set(
      node.observations
        .map(({ properties: values }) => values[key])
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  return values.length === 1 ? (values[0] ?? null) : null;
};

const graphsComplete = (context: ItemContext): boolean =>
  absenceClaimable(context.leftGraph.coverage) &&
  absenceClaimable(context.rightGraph.coverage);
