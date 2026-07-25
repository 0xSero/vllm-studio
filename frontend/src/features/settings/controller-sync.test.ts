import assert from "node:assert/strict";
import { test } from "node:test";
import { includeSavedController } from "@/lib/api/controllers";

test("active controller is added to an empty saved list", () => {
  assert.deepEqual(includeSavedController([], { url: "http://spark.local:8080/" }), [
    { url: "http://spark.local:8080" },
  ]);
});

test("active controller does not replace saved metadata", () => {
  const saved = [
    {
      url: "http://spark.local:8080",
      name: "Spark",
      apiKey: "saved-key",
    },
  ];

  assert.equal(
    includeSavedController(saved, {
      url: "http://spark.local:8080/",
      apiKey: "different-key",
    }),
    saved,
  );
});
