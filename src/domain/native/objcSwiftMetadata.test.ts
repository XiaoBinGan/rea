import { describe, expect, it } from "vitest";

import { inspectNativeDispatchMetadata } from "./objcSwiftMetadata.js";
import {
  classifySwiftSymbol,
  isSwiftMangledSymbolName,
  isSwiftSymbolName,
} from "../swiftSymbolClassification.js";

describe("ObjC/Swift metadata", () => {
  it("bounds symbol projections and labels symbol-only metadata as partial", () => {
    const result = inspectNativeDispatchMetadata(
      [
        { address: "ram:0x1000", name: "OBJC_CLASS_$_StoreController" },
        { address: "ram:0x2000", name: "-[StoreController buildTapped:]" },
        { address: "ram:0x3000", name: "$s5Store7launchyyF" },
      ],
      2,
    );
    expect(result.objc_classes).toHaveLength(1);
    expect(result.objc_dispatch_implementations).toHaveLength(1);
    expect(result.objc_classes[0]).toMatchObject({
      is_meta_class: null,
      is_root_class: null,
      ivar_count: null,
    });
    expect(result.objc_classes[0]?.methods[0]).toMatchObject({
      is_required: null,
      is_optional: null,
    });
    expect(result.swift_symbols).toHaveLength(0);
    expect(result.coverage).toContainEqual(
      expect.objectContaining({
        facet: "objc_class_symbols",
        status: "partial",
        reason: expect.stringContaining("record_limit_reached"),
      }),
    );
    expect(result.coverage).toContainEqual(
      expect.objectContaining({
        facet: "swift_dispatch_tables",
        status: "unsupported",
      }),
    );
  });

  it("projects every accepted Swift mangling prefix and counts it", () => {
    const names = [
      "$s5Store7launchyyF",
      "_$s5Store7launchyyF",
      "$S5Store7launchyyF",
      "_$S5Store7launchyyF",
      "_T05Store7launchyyF",
      "@__swiftmacro_5Store7launchfMf_",
      "$e5Store7launchyyF",
      "_$e5Store7launchyyF",
      "_TtC5Store11StoreHandle",
      "_Tprintf",
    ];
    const result = inspectNativeDispatchMetadata(
      names.map((name, index) => ({
        address: `ram:0x${(0x1000 + index * 0x100).toString(16)}`,
        name,
      })),
      names.length,
    );

    expect(result.swift_symbols.map((entry) => entry.mangled_name)).toEqual(
      names.slice(0, -1),
    );
    expect(
      result.swift_symbols.every((entry) => entry.decode.status === "partial"),
    ).toBe(true);
    expect(result.coverage).toContainEqual(
      expect.objectContaining({
        facet: "swift_declarations",
        examined: 9,
        decoded: 0,
      }),
    );
  });
});

describe("Swift symbol recognition follows the shared owner predicate", () => {
  it.each([
    ["__T04main4PairVMa", "structs"],
    ["_TtC5Store11StoreHandle", "classes"],
  ] as const)(
    "retains %s with pinned partial declaration coverage",
    (name, category) => {
      // The shared owner recognizes the name even when the demangler mangling
      // prefixes alone do not, so retention must not re-derive that rule.
      expect(isSwiftMangledSymbolName(name)).toBe(false);
      expect(isSwiftSymbolName(name)).toBe(true);
      expect(classifySwiftSymbol(name)).toStrictEqual({ category });
      const result = inspectNativeDispatchMetadata([
        { address: "ram:0x1000", name },
      ]);
      expect(result.swift_symbols).toHaveLength(1);
      expect(result.swift_symbols[0]?.mangled_name).toBe(name);
      expect(result.coverage).toContainEqual({
        facet: "swift_declarations",
        status: "partial",
        reason: "symbols_are_not_demangled_declarations",
        examined: 1,
        decoded: 0,
      });
      expect(result.coverage).not.toContainEqual(
        expect.objectContaining({
          facet: "swift_declarations",
          reason: "no_swift_symbols_observed",
        }),
      );
    },
  );

  it("retains an Objective-C class symbol for a Swift class as Swift-unclassified", () => {
    const name = "OBJC_CLASS_$__TtC5Store11StoreHandle";
    expect(isSwiftMangledSymbolName(name)).toBe(false);
    expect(isSwiftSymbolName(name)).toBe(true);
    expect(classifySwiftSymbol(name)).toStrictEqual({ category: null });
    const result = inspectNativeDispatchMetadata([
      { address: "ram:0x1000", name },
    ]);
    expect(result.swift_symbols.map((entry) => entry.mangled_name)).toEqual([
      name,
    ]);
    expect(result.coverage).toContainEqual({
      facet: "swift_declarations",
      status: "partial",
      reason: "symbols_are_not_demangled_declarations",
      examined: 1,
      decoded: 0,
    });
  });

  it("keeps Objective-C selectors and other non-Swift names out of Swift symbols", () => {
    const names = [
      "-[Foo bar_TtP]",
      "-[Thing do_TtWork]",
      "_Tprintf",
      "OBJC_CLASS_$_StoreController",
      "-[Class sel]",
    ];
    // A `_Tt` substring leaves the category unknown; it must not make the name
    // Swift or admit it to swift_symbols (the finding this test pins).
    expect(classifySwiftSymbol(names[0] ?? "")).toStrictEqual({
      category: null,
    });
    for (const name of names) expect(isSwiftSymbolName(name)).toBe(false);
    const result = inspectNativeDispatchMetadata(
      names.map((name, index) => ({
        address: `ram:0x${(0x1000 + index * 0x100).toString(16)}`,
        name,
      })),
      names.length,
    );
    expect(result.swift_symbols).toEqual([]);
    expect(result.coverage).toContainEqual({
      facet: "swift_declarations",
      status: "unsupported",
      reason: "no_swift_symbols_observed",
      examined: 0,
      decoded: 0,
    });
  });
});
