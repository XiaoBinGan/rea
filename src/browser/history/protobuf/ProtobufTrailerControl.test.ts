import { expect, it } from "vitest";

import { decodeProtobufBody } from "./ProtobufBody.js";
import { ProtobufBudget } from "./ProtobufWire.js";

const source = {
  pointer: "/response/content/text",
  content_type: "application/grpc-web+proto",
  body_sha256: "a".repeat(64),
};
const same = (value: string) => value;
const frame = (bytes: Buffer, flag = 0) => {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
};
const trailerBody = (value: string) =>
  Buffer.concat([
    frame(Buffer.from("0801", "hex")),
    frame(Buffer.from(`grpc-status: 0\r\nx-note: ${value}\r\n`, "utf8"), 128),
  ]);

it("rejects a gRPC-web trailer value that carries a control character", async () => {
  for (const control of ["\u0000", "\n", "\r", "\u000b", "\u007f"]) {
    const decoded = await decodeProtobufBody(
      trailerBody(`a${control}b`),
      "grpc-web",
      source,
      same,
      new ProtobufBudget(),
    );
    expect(decoded.status, JSON.stringify(control)).toBe("partial");
    expect(decoded.frames[1]).toMatchObject({
      status: "partial",
      error: {
        offset: 12,
        reason: "Invalid gRPC-web trailer header block",
      },
    });
    // The preceding data frame and its message stay decoded.
    expect(decoded.frames[0]).toMatchObject({ status: "complete" });
    expect(decoded.fields).toContainEqual(
      expect.objectContaining({ number: 1, value: "1" }),
    );
  }

  const valid = await decodeProtobufBody(
    trailerBody("a\tb"),
    "grpc-web",
    source,
    same,
    new ProtobufBudget(),
  );
  expect(valid.status).toBe("complete");
  expect(valid.frames[1]?.trailers).toEqual([
    { name: "grpc-status", value: "0" },
    { name: "x-note", value: "a\tb" },
  ]);
});
