import { describe, expect, it } from "vitest";

import {
  categorizeSwiftTypes,
  discoverObjcProtocols,
} from "./symbolAnalysis.js";

describe("modern Swift category evidence", () => {
  it.each([
    ["$s4main7ServiceCMa", "classes"],
    ["$s4main5StateOMa", "enums"],
    ["$s4main7ScoringPMp", "protocols"],
    ["$s4main5OuterV5InnerCMa", "classes"],
    ["$s4main4PairV5otherE7doubledSiyF", "extensions"],
    ["$S4main4PairVMa", "structs"],
    ["_T04main4PairVMa", "structs"],
    ["$s4_TtX4PairVMa", "structs"],
  ] as const)("decodes nominal contexts for %s", (name, category) => {
    expect(
      categorizeSwiftTypes([{ address: "0x1", name }], { category }),
    ).toMatchObject({
      total: 1,
      categories: { [category]: { count: 1 } },
      unclassified: [],
    });
  });

  it("retains unresolved Swift observations under category filters", () => {
    const names = [
      "$s4main13swiftIndirectySiAA7Scoring_p_SitF",
      "$sSi4mainE7doubledSiyF",
      "$s9999999999999999999999BadVMa",
      "$s4main04PairVMa",
    ];
    const result = categorizeSwiftTypes(
      names.map((name, index) => ({ address: String(index), name })),
      { category: "structs" },
    );
    expect(result).toMatchObject({
      total: 0,
      unclassified: names.map((name) => ({
        name,
        mangled_names: [name],
        reason: "category_not_decoded",
      })),
      limitations: expect.arrayContaining([
        expect.stringContaining("could not be established"),
      ]),
    });
    expect(
      categorizeSwiftTypes([{ address: "0x1", name: names[0] ?? "" }], {
        category: "structs",
        pattern: "missing",
      }),
    ).toMatchObject({ total: 0, unclassified: [] });
  });

  it("deduplicates display names after selecting a category", () => {
    expect(
      categorizeSwiftTypes(
        [
          { address: "0x1", name: "shared" },
          { address: "0x2", name: "shared" },
        ],
        { category: "structs" },
        [
          { address: "0x1", name: "$s4main7ServiceCMa" },
          { address: "0x2", name: "$s4main4PairVMa" },
        ],
      ),
    ).toMatchObject({
      total: 1,
      categories: { structs: { items: [{ address: "0x2", name: "shared" }] } },
    });
  });
});

describe("Swift alias ambiguity", () => {
  it("reports conflicting aliases rather than choosing a category", () => {
    expect(
      categorizeSwiftTypes(
        [{ address: "0x1", name: "shared" }],
        { category: "structs" },
        [
          { address: "0x1", name: "$s4main4PairVMa" },
          { address: "0x1", name: "$s4main7ServiceCMa" },
        ],
      ),
    ).toMatchObject({
      total: 0,
      unclassified: [
        {
          name: "shared",
          reason: "conflicting_categories",
          mangled_names: ["$s4main4PairVMa", "$s4main7ServiceCMa"],
        },
      ],
    });
  });

  it("retains manglings whose prefix the demangler accepts", () => {
    const names = [
      "$e4main7ServiceCMa",
      "_$e4main7ServiceCMa",
      "@__swiftmacro_4main7ServiceCMa",
    ];
    const result = categorizeSwiftTypes(
      names.map((name, index) => ({ address: `0x${String(index)}`, name })),
    );
    expect(result.categories.other?.items.map((item) => item.name)).toEqual(
      names,
    );
    expect(result.unclassified.map((item) => item.name)).toEqual(names);
  });

  it("keeps legacy names with an optional leading underscore", () => {
    expect(
      categorizeSwiftTypes([{ address: "0x1", name: "__T04main4PairVMa" }], {
        category: "structs",
      }),
    ).toMatchObject({
      total: 1,
      categories: { structs: { count: 1 } },
      unclassified: [],
    });
  });

  it("does not let a demangler-only alias erase a decoded category", () => {
    const result = categorizeSwiftTypes(
      [{ address: "0x1", name: "$s4main7ServiceCMa" }],
      {},
      [{ address: "0x1", name: "$e4main7ServiceCMa" }],
    );
    expect(result.categories.classes?.items).toMatchObject([
      {
        name: "$s4main7ServiceCMa",
        mangled_names: ["$s4main7ServiceCMa", "$e4main7ServiceCMa"],
      },
    ]);
    expect(result.categories.other?.items).toEqual([]);
  });
});

describe("Objective-C and Swift protocol discovery", () => {
  const at = (name: string) => [{ address: "0x1", name }];

  it("selects Swift protocols through the category owner", () => {
    const names = [
      "$s4main3FooP",
      "__T04main3FooP",
      "_TtP4main3Foo_",
      "$s4main7ScoringPMp",
    ];
    expect(discoverObjcProtocols(names.flatMap(at))).toMatchObject({
      count: 4,
      protocols: names.map((name) => ({ address: "0x1", name })),
    });
  });

  it("keeps protocol-nominal Swift symbols and drops undecoded ones", () => {
    expect(
      discoverObjcProtocols([
        { address: "0x1", name: "$s4main7ScoringP5scoreSiyFTq" },
        { address: "0x2", name: "$s4main7ScoringTL" },
      ]),
    ).toMatchObject({
      count: 1,
      protocols: [{ address: "0x1", name: "$s4main7ScoringP5scoreSiyFTq" }],
    });
  });

  it("keeps the Objective-C-only protocol symbol marker", () => {
    expect(discoverObjcProtocols(at("OBJC_PROTOCOL_$_Foo"))).toMatchObject({
      count: 1,
      protocols: [{ address: "0x1", name: "OBJC_PROTOCOL_$_Foo" }],
    });
  });

  it("rejects names that merely contain a legacy protocol substring", () => {
    const names = [
      "-[Foo bar_TtP]",
      "__TtP4main3Foo_",
      "_Tprintf",
      "OBJC_CLASS_$_Foo",
      "-[Class sel]",
    ];
    expect(discoverObjcProtocols(names.flatMap(at))).toMatchObject({
      count: 0,
      protocols: [],
    });
  });
});

describe("Swift symbol gate", () => {
  it("does not treat Objective-C selectors containing _Tt as Swift symbols", () => {
    const names = ["-[Foo bar_TtP]", "-[Thing do_TtWork]", "prefix_TtOther"];
    expect(
      categorizeSwiftTypes(
        names.map((name, index) => ({
          address: `0x${index.toString(16)}`,
          name,
        })),
      ),
    ).toMatchObject({
      total: 0,
      categories: { other: { count: 0, items: [] } },
      unclassified: [],
    });
  });

  it("does not accept an Objective-C selector as a same-address Swift alias", () => {
    expect(
      categorizeSwiftTypes([{ address: "0x1", name: "shared" }], {}, [
        { address: "0x1", name: "-[Foo bar_TtP]" },
      ]),
    ).toMatchObject({ total: 0, unclassified: [] });
  });

  it("keeps an Objective-C class symbol for a Swift class as Swift-unclassified", () => {
    const name = "OBJC_CLASS_$__TtC5Store11StoreHandle";
    expect(categorizeSwiftTypes([{ address: "0x1", name }])).toMatchObject({
      total: 1,
      categories: { other: { count: 1 } },
      unclassified: [{ name, reason: "category_not_decoded" }],
    });
  });
});
