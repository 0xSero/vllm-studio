import { describe, expect, test } from "bun:test";

import { normalizeToolRequest } from "./content-normalizer";

type Tool = {
  type: "function";
  function: Record<string, unknown>;
};

describe("normalizeToolRequest", () => {
  const makeShuffledTools = (): Tool[] => [
    {
      type: "function",
      function: {
        parameters: { type: "object", properties: {} },
        name: "charlie",
        description: "Charlie tool",
      },
    },
    {
      type: "function",
      function: {
        description: "Alpha tool",
        name: "alpha",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "bravo",
        description: "Bravo tool",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  const makeCanonicalTools = (): Tool[] => [
    {
      type: "function",
      function: {
        name: "alpha",
        description: "Alpha tool",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "bravo",
        description: "Bravo tool",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "charlie",
        description: "Charlie tool",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  test("sorts tools by function.name", () => {
    const result = normalizeToolRequest({ tools: makeShuffledTools() });
    const resultTools = result["tools"] as Array<Record<string, unknown>>;
    expect(
      resultTools.map((tool) => (tool["function"] as Record<string, unknown>)["name"]),
    ).toEqual(["alpha", "bravo", "charlie"]);
  });

  test("converts and sorts legacy functions", () => {
    const functions = [
      { name: "charlie", description: "Charlie fn", parameters: {} },
      { name: "alpha", description: "Alpha fn", parameters: {} },
      { name: "bravo", description: "Bravo fn", parameters: {} },
    ];
    const result = normalizeToolRequest({ functions });
    expect(result["functions"]).toBeUndefined();
    const resultTools = result["tools"] as Array<Record<string, unknown>>;
    expect(
      resultTools.map((tool) => (tool["function"] as Record<string, unknown>)["name"]),
    ).toEqual(["alpha", "bravo", "charlie"]);
    expect(resultTools[0]).toEqual({
      type: "function",
      function: expect.objectContaining({ name: "alpha" }),
    });
  });

  test("produces stable JSON for shuffled vs original tool order", () => {
    const shuffled = normalizeToolRequest({ tools: makeShuffledTools() });
    const canonical = normalizeToolRequest({ tools: makeCanonicalTools() });
    expect(JSON.stringify(shuffled)).toEqual(JSON.stringify(canonical));
  });

  test("canonicalizes function object key order", () => {
    const tool = {
      type: "function",
      function: {
        parameters: { type: "object" },
        extra: "value",
        name: "single",
        description: "A tool",
        another: 1,
      },
    };
    const result = normalizeToolRequest({ tools: [tool] });
    const resultTools = result["tools"] as Array<Record<string, unknown>>;
    const firstTool = resultTools[0];
    if (firstTool === undefined) {
      throw new Error("expected at least one tool");
    }
    const functionObject = firstTool["function"] as Record<string, unknown>;
    expect(Object.keys(functionObject)).toEqual([
      "name",
      "description",
      "parameters",
      "another",
      "extra",
    ]);
  });
});
