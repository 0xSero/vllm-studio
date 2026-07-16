import assert from "node:assert/strict";
import test from "node:test";

import {
  movePinnedEntryBefore,
  orderPinnedEntries,
} from "../src/features/agent/ui/projects-nav/pinned-order";

const entries = [
  { id: "thread-new", identities: ["runtime-new", "thread-new"] },
  { id: "thread-old", identities: ["runtime-old", "thread-old"] },
  { id: "thread-third", identities: ["thread-third"] },
];

test("pinned order stays stable when a local runtime adopts its durable thread id", () => {
  const ordered = orderPinnedEntries(entries, ["runtime-old", "thread-new"]);

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["thread-old", "thread-new", "thread-third"],
  );
});

test("pinned reorder persists visible canonical identities without stale aliases", () => {
  const order = movePinnedEntryBefore(
    entries,
    ["missing-thread", "runtime-old", "thread-new"],
    "thread-third",
    "thread-old",
  );

  assert.deepEqual(order, ["thread-third", "thread-old", "thread-new"]);
});

test("dropping a pinned row at the end keeps every row exactly once", () => {
  const order = movePinnedEntryBefore(
    entries,
    ["thread-new", "thread-old", "thread-third"],
    "thread-new",
    null,
  );

  assert.deepEqual(order, ["thread-old", "thread-third", "thread-new"]);
});
