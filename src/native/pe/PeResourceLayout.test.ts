import { describe, expect, it } from "vitest";

import { readPeResourceLayout } from "./PeResourceLayout.js";

interface FixtureSection {
  readonly name: string;
  readonly rva: number;
  readonly virtualSize: number;
  readonly offset: number;
  readonly size: number;
}

/** Hand-authored PE header and section table, independent of the decoder. */
const peImage = (sections: readonly FixtureSection[]): Buffer => {
  const headerSize = 0x400;
  const bytes = Buffer.alloc(
    Math.max(headerSize, ...sections.map(({ offset, size }) => offset + size)),
  );
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 60);
  bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(0x14c, 0x84);
  bytes.writeUInt16LE(sections.length, 0x86);
  bytes.writeUInt16LE(224, 0x94);
  bytes.writeUInt16LE(0x10b, 0x98);
  bytes.writeUInt32LE(headerSize, 0x98 + 60);
  bytes.writeUInt32LE(0, 0x98 + 92);
  sections.forEach((section, index) => {
    const at = 0x98 + 224 + index * 40;
    bytes.write(section.name, at, "ascii");
    bytes.writeUInt32LE(section.virtualSize, at + 8);
    bytes.writeUInt32LE(section.rva, at + 12);
    bytes.writeUInt32LE(section.size, at + 16);
    bytes.writeUInt32LE(section.offset, at + 20);
  });
  return bytes;
};

const resourceSection: FixtureSection = {
  name: ".rsrc",
  rva: 0x2000,
  virtualSize: 0x100,
  offset: 0x400,
  size: 0x200,
};

/** A declared section whose virtual start is below SizeOfHeaders. */
const lowSection: FixtureSection = {
  name: ".low",
  rva: 0x100,
  virtualSize: 0x10,
  offset: 0x600,
  size: 0x200,
};

describe("PE resource RVA mapping", () => {
  it("rejects an empty payload at a declared section start below the headers", () => {
    const layout = readPeResourceLayout(peImage([resourceSection, lowSection]));
    expect(() => layout.map(lowSection.rva, 0)).toThrow(
      /Ambiguous resource header RVA mapping/,
    );
  });

  it("rejects a nonempty payload at the same conflicting RVA", () => {
    const layout = readPeResourceLayout(peImage([resourceSection, lowSection]));
    expect(() => layout.map(lowSection.rva, 4)).toThrow(
      /Ambiguous resource header RVA mapping/,
    );
  });

  it("keeps a header-backed empty payload that no section owns", () => {
    const layout = readPeResourceLayout(peImage([resourceSection]));
    expect(layout.map(0x100, 0)).toBe(0x100);
  });

  it("keeps the section-end ownership of an empty payload at the section limit", () => {
    const layout = readPeResourceLayout(peImage([resourceSection, lowSection]));
    expect(
      layout.map(resourceSection.rva + resourceSection.virtualSize, 0),
    ).toBe(resourceSection.offset + resourceSection.virtualSize);
  });
});
