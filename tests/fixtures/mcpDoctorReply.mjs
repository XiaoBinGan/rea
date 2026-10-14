import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const snapshot = JSON.parse(await readFile(process.argv[2], "utf8"));
const reply = structuredClone(snapshot.reply);
const mode = process.argv[3];
if (mode === "invalid") {
  reply.structuredContent.schema_violation_control = true;
  reply.content = reply.content.map((item) =>
    item.type === "text"
      ? { ...item, text: JSON.stringify(reply.structuredContent) }
      : item,
  );
}
if (mode === "tool-error" || mode === "tool-error-without-content") {
  // The production transport removes REA's structured error carrier before
  // delivery, so a tool-level failure reaches the doctor with text only.
  delete reply.structuredContent;
  reply.isError = true;
  reply.content =
    mode === "tool-error"
      ? [{ type: "text", text: "injected binary_session failure" }]
      : [];
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: snapshot.protocolVersion,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: snapshot.serverInfo,
      };
      break;
    case "tools/list":
      result = snapshot.tools;
      break;
    case "prompts/list":
      result = snapshot.prompts;
      break;
    case "tools/call":
      if (request.params.name === "binary_session") result = reply;
      break;
    case "ping":
      result = {};
      break;
  }
  const response =
    result === undefined
      ? { error: { code: -32601, message: "Unknown fixture method or tool" } }
      : { result };
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response })}\n`,
  );
});
