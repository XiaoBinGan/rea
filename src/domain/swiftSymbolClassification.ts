const LEGACY_CATEGORIES = [
  ["_TtC", "classes"],
  ["_TtV", "structs"],
  ["_TtO", "enums"],
  ["_TtP", "protocols"],
  ["_TtE", "extensions"],
] as const;

/** Supported procedure categories derived from Swift symbol encodings. */
export type SwiftTypeCategory = (typeof LEGACY_CATEGORIES)[number][1] | "other";

const NOMINAL_CATEGORIES: ReadonlyMap<string, SwiftTypeCategory> = new Map([
  ["C", "classes"],
  ["V", "structs"],
  ["O", "enums"],
  ["P", "protocols"],
]);

/**
 * Start of a Swift demangler mangling, including the optional leading
 * underscore of legacy encodings (`__T0…`). Shared by `classifySwiftSymbol`
 * and `isSwiftSymbolName` so both agree on which manglings are Swift.
 */
const SWIFT_MANGLING_START = /^_?(?:\$[sS]|_T0)/u;

/**
 * Anchored visible Swift runtime nominal name (`_Tt…`): the name itself, an
 * optionally doubled leading underscore, or an Objective-C class/metaclass
 * symbol for a Swift class (`OBJC_CLASS_$__TtC…`). It is anchored rather than a
 * substring test so an Objective-C selector such as `-[Foo bar_TtP]` is not
 * treated as Swift.
 */
const SWIFT_RUNTIME_NOMINAL_START =
  /^_?(?:(?:OBJC_CLASS_|OBJC_METACLASS_)\$_)?_Tt/u;

/**
 * Recognize Swift manglings and decode literal module/nominal contexts.
 * Substitutions, generic contexts, and other encodings remain unknown.
 */
export const classifySwiftSymbol = (
  name: string,
): { readonly category: SwiftTypeCategory | null } | undefined => {
  const prefix = SWIFT_MANGLING_START.exec(name);
  if (prefix === null) {
    if (!name.includes("_Tt")) return undefined;
    // A `_Tt` occurrence only shows a legacy encoding is present somewhere; it
    // does not establish that the name is Swift. That gate is owned by
    // `isSwiftSymbolName`, so an unrecognized `_Tt` context stays
    // category-unknown here rather than becoming Swift by itself.
    return {
      category:
        LEGACY_CATEGORIES.find(([prefix]) => name.startsWith(prefix))?.[1] ??
        null,
    };
  }
  const mangling = name.slice(prefix[0].length);
  let offset = identifierEnd(mangling, 0);
  if (offset === undefined) return { category: null };
  let category: SwiftTypeCategory | null = null;
  for (;;) {
    const end = identifierEnd(mangling, offset);
    if (end === undefined) break;
    const kind = mangling.charAt(end);
    const nominal = NOMINAL_CATEGORIES.get(kind);
    if (nominal === undefined) {
      // Current swiftc emits protocol descriptors as `…<Nominal>Mp` without
      // the nominal `P` marker (e.g. `_$s4main7ScoringMp`). Decode that exact
      // suffix; unknown substitution encodings stay unclassified, never guessed.
      if (mangling.slice(end) === "Mp") category = "protocols";
      else if (kind === "E" && category !== null) category = "extensions";
      break;
    }
    category = nominal;
    offset = end + 1;
  }
  return { category };
};

/**
 * Prefixes accepted by Swift's demangler as manglings. This is deliberately
 * narrower than visible Swift runtime class names (`_Tt…`): those names are
 * useful metadata symbols but are not themselves demangler manglings.
 */
const SWIFT_MANGLING_PREFIXES = [
  "_T0",
  "$S",
  "_$S",
  "$s",
  "_$s",
  "@__swiftmacro_",
  "$e",
  "_$e",
] as const;

/** Recognize names the Swift demangler accepts as mangled symbols. */
export const isSwiftMangledSymbolName = (name: string): boolean =>
  SWIFT_MANGLING_PREFIXES.some((prefix) => name.startsWith(prefix));

/**
 * Recognize whether a symbol name is Swift at all: a demangler mangling, a
 * visible Swift runtime nominal name (`_Tt…`), or an Objective-C
 * class/metaclass symbol for a Swift class. Which nominal category a Swift name
 * decodes to is a separate question owned by `classifySwiftSymbol`. An
 * undecoded category does not make a Swift name non-Swift, and a name that
 * merely contains `_Tt` is not Swift.
 */
export const isSwiftSymbolName = (name: string): boolean =>
  isSwiftMangledSymbolName(name) ||
  SWIFT_MANGLING_START.test(name) ||
  SWIFT_RUNTIME_NOMINAL_START.test(name);

const identifierEnd = (
  mangling: string,
  offset: number,
): number | undefined => {
  const lengthToken = /^[1-9][0-9]*/u.exec(mangling.slice(offset))?.[0];
  if (lengthToken === undefined) return undefined;
  const start = offset + lengthToken.length;
  const end = start + Number(lengthToken);
  // Swift identifiers with substitutions/punycode need a fuller decoder.
  if (
    !Number.isSafeInteger(end) ||
    end > mangling.length ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(mangling.slice(start, end))
  )
    return undefined;
  return end;
};
