import { canonicalJson } from "./comparisonSemantics.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";

import type { FunctionSnapshot } from "./functionDossierEvidence.js";
import type { FunctionComparisonResult } from "./functionComparisonSchemas.js";

export const identityProjection = (snapshot: FunctionSnapshot) => ({
  name: snapshot.dossier.procedure.name,
  signature: snapshot.dossier.procedure.signature,
  locals: snapshot.dossier.procedure.locals
    .map(({ description }) => description)
    .sort(),
});

export const functionMatch = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
): FunctionComparisonResult["function_match"] => {
  const leftName = left.dossier.procedure.name;
  const rightName = right.dossier.procedure.name;
  const stableNames = !isAutoName(leftName) && !isAutoName(rightName);
  if (stableNames && leftName === rightName)
    return {
      status: "matched",
      method: "symbol",
      left_name: leftName,
      right_name: rightName,
    };
  return {
    status: stableNames ? "mismatched" : "ambiguous",
    method: "explicit",
    left_name: leftName,
    right_name: rightName,
  };
};

export const normalizeCfg = (
  blocks: FunctionSnapshot["dossier"]["basic_blocks"],
): readonly unknown[] | null => {
  const parsed: {
    block: (typeof blocks)[number];
    start: bigint;
    end: bigint;
  }[] = [];
  for (const block of blocks) {
    const start = parseAddress(block.start);
    const end = parseAddress(block.end);
    if (start === null || end === null || end <= start) return null;
    parsed.push({ block, start, end });
  }
  const ordered = parsed.sort((left, right) =>
    left.start < right.start ? -1 : left.start > right.start ? 1 : 0,
  );
  if (new Set(ordered.map(({ start }) => start)).size !== ordered.length)
    return null;
  const indices = new Map(ordered.map(({ start }, index) => [start, index]));
  const graph = [];
  for (const { block, start, end } of ordered) {
    const successors: number[] = [];
    for (const address of block.successors) {
      const parsedAddress = parseAddress(address);
      if (parsedAddress === null) return null;
      const index = indices.get(parsedAddress);
      if (index === undefined) return null;
      successors.push(index);
    }
    graph.push({
      size: String(end - start),
      successors: successors.sort((left, right) => left - right),
    });
  }
  return graph;
};

type ReferenceEdge = FunctionSnapshot["dossier"]["outgoing_references"][number];

/**
 * Within one artifact an endpoint is identified by its address, whether or not
 * a procedure record names it: the address names exactly one location, and a
 * missing procedure record leaves the name unknown rather than making the
 * endpoint a different target. Across artifacts an address identifies nothing,
 * so a named endpoint is compared by its name and an unnamed endpoint stays
 * unknown (null).
 */
const referenceEndpoint = (
  procedure: ReferenceEdge["source_procedure"],
  address: string,
  sameArtifact: boolean,
): string | { readonly address: string } | null =>
  sameArtifact ? { address } : procedure !== null ? procedure.name : null;

/**
 * True when the two reference endpoint projections could still describe the
 * same references: a known endpoint never matches a different known endpoint,
 * and an unknown (null) endpoint can stand for any name. A projection
 * difference that only an unknown endpoint identity can absorb is unresolved
 * identity, not a change (AGENTS.md: unresolved identity must remain unknown
 * rather than being treated as absent, foreign, or aligned). Entries are
 * matched exactly (Kuhn augmenting paths); beyond a size bound the caller
 * keeps the conservative comparison rather than spending quadratic time.
 */
export const referenceEndpointsCouldMatch = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean => {
  if (left.length !== right.length || left.length === 0) return false;
  if (left.length > 200 || right.length > 200) return false;
  const leftEntries = left.map(referenceEndpointEntryOf);
  const rightEntries = right.map(referenceEndpointEntryOf);
  if (![...leftEntries, ...rightEntries].some(entryHasUnknownEndpoint))
    return false;
  const matchesRight: number[] = new Array(rightEntries.length).fill(-1);
  const augment = (leftIndex: number, visited: boolean[]): boolean => {
    const leftEntry = leftEntries[leftIndex];
    if (leftEntry === undefined) return false;
    for (let r = 0; r < rightEntries.length; r++) {
      if (visited[r]) continue;
      const rightEntry = rightEntries[r];
      if (
        rightEntry === undefined ||
        !endpointEntriesMatch(leftEntry, rightEntry)
      )
        continue;
      visited[r] = true;
      const partner = matchesRight[r] ?? -1;
      if (partner === -1 || augment(partner, visited)) {
        matchesRight[r] = leftIndex;
        return true;
      }
    }
    return false;
  };
  for (let l = 0; l < leftEntries.length; l++) {
    const visited: boolean[] = new Array(rightEntries.length).fill(false);
    if (!augment(l, visited)) return false;
  }
  return true;
};

/** The projection entries carry a direction and two endpoint values. */
const referenceEndpointEntryOf = (value: unknown): ReferenceEndpointEntry => {
  const entry = value as ReferenceEndpointEntry;
  const endpoint = (item: unknown): boolean =>
    item === null || typeof item === "string" || typeof item === "object";
  if (
    (entry.direction !== "in" && entry.direction !== "out") ||
    !endpoint(entry.source) ||
    !endpoint(entry.target)
  )
    throw new TypeError("Reference endpoint projection entry is malformed");
  return entry;
};

export type ReferenceEndpointEntry = {
  readonly direction: "in" | "out";
  readonly source: ReferenceEndpointValue;
  readonly target: ReferenceEndpointValue;
};
type ReferenceEndpointValue = string | { readonly address: string } | null;

const endpointValueMatches = (
  x: ReferenceEndpointValue,
  y: ReferenceEndpointValue,
): boolean =>
  x === null ||
  y === null ||
  (typeof x === "string" && typeof y === "string"
    ? x === y
    : typeof x === "object" && typeof y === "object"
      ? x.address === y.address
      : false);

const entryHasUnknownEndpoint = (entry: ReferenceEndpointEntry): boolean =>
  entry.source === null || entry.target === null;

const endpointEntriesMatch = (
  a: ReferenceEndpointEntry,
  b: ReferenceEndpointEntry,
): boolean =>
  a.direction === b.direction &&
  endpointValueMatches(a.source, b.source) &&
  endpointValueMatches(a.target, b.target);

export const referenceProjection = (
  snapshot: FunctionSnapshot,
  sameArtifact: boolean,
) =>
  sorted(
    [
      ...snapshot.dossier.incoming_references.map((item) => ({
        direction: "in",
        item,
      })),
      ...snapshot.dossier.outgoing_references.map((item) => ({
        direction: "out",
        item,
      })),
    ].map(({ direction, item }) => ({
      direction,
      source: referenceEndpoint(
        item.source_procedure,
        item.source_address,
        sameArtifact,
      ),
      target: referenceEndpoint(
        item.target_procedure,
        item.target_address,
        sameArtifact,
      ),
    })),
  );

export const referenceKindProjection = (
  snapshot: FunctionSnapshot,
  sameArtifact: boolean,
): readonly unknown[] | null => {
  const edges = [
    ...snapshot.dossier.incoming_references.map((edge) => ({
      direction: "in",
      edge,
    })),
    ...snapshot.dossier.outgoing_references.map((edge) => ({
      direction: "out",
      edge,
    })),
  ];
  if (edges.some(({ edge }) => !edge.kind.available)) return null;
  return sorted(
    edges.map(({ direction, edge }) => {
      if (!edge.kind.available)
        throw new TypeError(
          "Reference-kind availability changed during projection",
        );
      return {
        direction,
        source: referenceEndpoint(
          edge.source_procedure,
          edge.source_address,
          sameArtifact,
        ),
        target: referenceEndpoint(
          edge.target_procedure,
          edge.target_address,
          sameArtifact,
        ),
        type: edge.kind.type,
        flow: edge.kind.flow,
        call: edge.kind.call,
        jump: edge.kind.jump,
        data: edge.kind.data,
        read: edge.kind.read,
        write: edge.kind.write,
        indirect: edge.kind.indirect,
        computed: edge.kind.computed,
        conditional: edge.kind.conditional,
        terminal: edge.kind.terminal,
        primary: edge.kind.primary,
        operand_index: edge.kind.operand_index,
        external: edge.kind.external,
      };
    }),
  );
};

/**
 * The provider reference kinds alone, without endpoint identity. Differing
 * known kinds establish a change whatever the endpoint identity, so the
 * reference comparison weighs them before it accounts for unknown endpoints.
 * Null when any endpoint lacks kind metadata.
 */
export const referenceKindFacets = (
  snapshot: FunctionSnapshot,
): readonly unknown[] | null => {
  const edges = [
    ...snapshot.dossier.incoming_references.map((edge) => ({
      direction: "in" as const,
      edge,
    })),
    ...snapshot.dossier.outgoing_references.map((edge) => ({
      direction: "out" as const,
      edge,
    })),
  ];
  if (edges.some(({ edge }) => !edge.kind.available)) return null;
  return sorted(
    edges.map(({ direction, edge }) => {
      if (!edge.kind.available)
        throw new TypeError(
          "Reference-kind availability changed during projection",
        );
      const { available, ...facets } = edge.kind;
      void available;
      return { direction, ...facets };
    }),
  );
};

export const commentProjection = (
  snapshot: FunctionSnapshot,
): readonly unknown[] | null => {
  const values = snapshot.dossier.comments.map(({ address, kind, text }) => ({
    offset: relativeAddress(address, snapshot.dossier.procedure.address),
    kind,
    text,
  }));
  return values.some(({ offset }) => offset === null) ? null : sorted(values);
};

export const stringAndNameProjection = (
  snapshot: FunctionSnapshot,
  includeSwiftLiterals = true,
): readonly unknown[] | null => {
  const values = [
    ...snapshot.dossier.referenced_strings.map(
      ({ source_address: sourceAddress, value }) => ({
        kind: "string",
        source_offset: relativeAddress(
          sourceAddress,
          snapshot.dossier.procedure.address,
        ),
        value,
      }),
    ),
    ...snapshot.dossier.referenced_names.map(
      ({ source_address: sourceAddress, value }) => ({
        kind: "name",
        source_offset: relativeAddress(
          sourceAddress,
          snapshot.dossier.procedure.address,
        ),
        value,
      }),
    ),
    ...(includeSwiftLiterals
      ? (snapshot.dossier.swift_string_literals ?? [])
      : []
    ).map(
      ({
        source_address: sourceAddress,
        value,
        representation,
        registers,
      }) => ({
        kind: "swift_string",
        source_offset: relativeAddress(
          sourceAddress,
          snapshot.dossier.procedure.address,
        ),
        value,
        representation,
        registers,
      }),
    ),
  ];
  return values.some(({ source_offset: offset }) => offset === null)
    ? null
    : sorted(values);
};

/**
 * A retained literal proves presence, not that every path through its site was examined.
 * A differing retained fact proves a change only when the opposite dossier is complete
 * and therefore establishes its absence.
 */
export const swiftLiteralSitesConflict = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
): boolean => {
  const leftSites = swiftLiteralSites(left);
  const rightSites = swiftLiteralSites(right);
  for (const site of new Set([
    ...leftSites.values.keys(),
    ...rightSites.values.keys(),
  ])) {
    const leftValues =
      leftSites.values.get(site) ?? (leftSites.complete ? [] : undefined);
    const rightValues =
      rightSites.values.get(site) ?? (rightSites.complete ? [] : undefined);
    if (leftValues === undefined || rightValues === undefined) continue;
    const leftFacts = new Set(leftValues);
    const rightFacts = new Set(rightValues);
    if (
      (rightSites.complete &&
        leftValues.some((value) => !rightFacts.has(value))) ||
      (leftSites.complete && rightValues.some((value) => !leftFacts.has(value)))
    )
      return true;
  }
  return false;
};

const swiftLiteralSites = (snapshot: FunctionSnapshot) => {
  const base = snapshot.dossier.procedure.address;
  const omissions = snapshot.dossier.swift_string_literal_omissions ?? [];
  const site = (sourceAddress: string, registers: readonly string[]) => {
    const offset = relativeAddress(sourceAddress, base);
    return offset === null ? null : canonicalJson([offset, registers]);
  };
  // Keep the same literal facts the full strings_names projection compares.
  const values = new Map<string, string[]>();
  for (const literal of snapshot.dossier.swift_string_literals ?? []) {
    const key = site(literal.source_address, literal.registers);
    if (key === null) continue;
    values.set(
      key,
      [
        ...(values.get(key) ?? []),
        canonicalJson([literal.value, literal.representation]),
      ].sort(compareUnicodeCodePoints),
    );
  }
  const complete =
    snapshot.dossier.swift_string_literals !== undefined &&
    omissions.length === 0;
  return { values, complete };
};

export const sorted = (values: readonly unknown[]): readonly unknown[] =>
  values
    .map((value) => ({
      value,
      json: canonicalJson(value, "Function normalization"),
    }))
    .sort((left, right) => compareUnicodeCodePoints(left.json, right.json))
    .map(({ value }) => value);

/** Recognize address-derived procedure names without excluding named FUN_ symbols. */
export const isAutoName = (name: string): boolean =>
  /^(?:sub_[0-9a-f]+|fcn\.[0-9a-f]+|FUN_[0-9a-f]+)$/iu.test(name);

const parseAddress = (value: string): bigint | null =>
  /^0x[0-9a-f]+$/iu.test(value) ? BigInt(value) : null;

const relativeAddress = (value: string, base: string): string | null => {
  const parsed = parseAddress(value);
  const parsedBase = parseAddress(base);
  return parsed === null || parsedBase === null || parsed < parsedBase
    ? null
    : String(parsed - parsedBase);
};
