import { describe, expect, it } from "vitest";

import {
  classifySwiftSymbol,
  isSwiftMangledSymbolName,
  isSwiftSymbolName,
} from "./swiftSymbolClassification.js";

describe("isSwiftSymbolName", () => {
  it.each([
    "$s4main3FooP",
    "__T04main4PairVMa",
    "_$s4main7ScoringMp",
    "_TtC5Store11StoreHandle",
    "_TtP4main3Foo_",
    "OBJC_CLASS_$__TtC5Store11StoreHandle",
    "OBJC_METACLASS_$__TtC5Store11StoreHandle",
    "$e4main7ServiceCMa",
    "_$e4main7ServiceCMa",
    "@__swiftmacro_4main7ServiceCMa",
  ])("recognizes Swift name %s", (name) => {
    expect(isSwiftSymbolName(name)).toBe(true);
  });

  it.each([
    "-[Foo bar_TtP]",
    "-[Thing do_TtWork]",
    "_Tprintf",
    "OBJC_CLASS_$_StoreController",
    "OBJC_METACLASS_$_StoreController",
    "-[Class sel]",
    "prefix_TtOther",
  ])("rejects non-Swift name %s", (name) => {
    expect(isSwiftSymbolName(name)).toBe(false);
  });
});

describe("classifySwiftSymbol contract", () => {
  it("decodes the recognized nominal categories", () => {
    expect(classifySwiftSymbol("__T04main4PairVMa")).toStrictEqual({
      category: "structs",
    });
    expect(classifySwiftSymbol("_TtC5Store11StoreHandle")).toStrictEqual({
      category: "classes",
    });
    expect(classifySwiftSymbol("$s4main3FooP")).toStrictEqual({
      category: "protocols",
    });
    expect(classifySwiftSymbol("$s4main7ScoringPMp")).toStrictEqual({
      category: "protocols",
    });
  });

  it("answers the category question independently of the Swift gate", () => {
    // A `_Tt` substring with no anchored runtime context is category-unknown;
    // whether the name is Swift at all is owned by `isSwiftSymbolName`.
    expect(classifySwiftSymbol("-[Foo bar_TtP]")).toStrictEqual({
      category: null,
    });
    expect(isSwiftSymbolName("-[Foo bar_TtP]")).toBe(false);
    expect(classifySwiftSymbol("_Tprintf")).toBeUndefined();
  });

  it("keeps the Swift gate for demangler-only prefixes", () => {
    for (const name of [
      "$e4main7ServiceCMa",
      "_$e4main7ServiceCMa",
      "@__swiftmacro_4main7ServiceCMa",
    ]) {
      expect(isSwiftMangledSymbolName(name)).toBe(true);
      expect(isSwiftSymbolName(name)).toBe(true);
      expect(classifySwiftSymbol(name)).toBeUndefined();
    }
  });
});
