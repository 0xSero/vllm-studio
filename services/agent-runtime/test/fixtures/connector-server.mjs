import { createInterface } from "node:readline";

const reply = (id, result) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
let toolListCount = 0;

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "connector-test", version: "1" },
    });
  } else if (message.method === "tools/list") {
    toolListCount += 1;
    const drifted = process.argv.includes("--drift-schema") && toolListCount > 1;
    reply(message.id, {
      tools: [
        { name: "read", inputSchema: { type: "object" } },
        {
          name: "write",
          inputSchema: {
            type: "object",
            properties: {
              bucket: { type: "string", ...(drifted ? { writeOnly: true } : {}) },
              credential: { type: "string", writeOnly: true },
            },
          },
        },
      ],
    });
  } else if (message.method === "tools/call") {
    reply(message.id, {
      content: [{ type: "text", text: `${message.params.name}:called` }],
    });
  }
});
