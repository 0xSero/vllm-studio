import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import {
  hrefWithOpenNonce,
  navigateToSessionHref,
} from "@/features/agent/ui/projects-nav/helpers";

// Regression coverage for the sidebar session-switch fix (b59040c3). Next 16's
// App Router silently no-ops a `router.push` to the same `/agent` route when
// only `session`/`open` searchParams change, so clicking a session did nothing.
// `navigateToSessionHref` soft-pushes, then verifies the URL actually moved and
// hard-navigates as a fallback. These tests pin that contract.

type FakeWindow = {
  location: { search: string; assign(href: string): void };
  setTimeout(cb: () => void, ms: number): number;
  __pendingTimers: Array<() => void>;
  __assigned: string[];
};

function installFakeWindow(search = ""): FakeWindow {
  const win: FakeWindow = {
    location: {
      search,
      assign: (href) => {
        win.__assigned.push(href);
      },
    },
    setTimeout: (cb) => {
      win.__pendingTimers.push(cb);
      return win.__pendingTimers.length;
    },
    __pendingTimers: [],
    __assigned: [],
  };
  (globalThis as { window?: unknown }).window = win;
  return win;
}

function flushTimers(win: FakeWindow): void {
  const pending = win.__pendingTimers.splice(0);
  for (const cb of pending) cb();
}

function makeRouter() {
  const pushed: string[] = [];
  return { push: (href: string) => pushed.push(href), pushed };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("always issues the soft router.push first", () => {
  installFakeWindow("?session=old");
  const router = makeRouter();
  navigateToSessionHref(router, "/agent?session=target");
  assert.deepEqual(router.pushed, ["/agent?session=target"]);
});

test("hard-navigates when the soft push did not move to the target session", () => {
  const win = installFakeWindow("?session=old"); // URL never moved
  const router = makeRouter();
  navigateToSessionHref(router, "/agent?session=target");
  flushTimers(win);
  assert.deepEqual(win.__assigned, ["/agent?session=target"]);
});

test("does NOT hard-navigate when the soft push already reached the target", () => {
  const win = installFakeWindow("?session=target"); // soft push succeeded
  const router = makeRouter();
  navigateToSessionHref(router, "/agent?session=target");
  flushTimers(win);
  assert.deepEqual(win.__assigned, []);
});

test("skips the verify/fallback entirely when the href has no session param", () => {
  const win = installFakeWindow("?session=old");
  const router = makeRouter();
  navigateToSessionHref(router, "/agent?open=abc");
  assert.equal(win.__pendingTimers.length, 0);
  flushTimers(win);
  assert.deepEqual(win.__assigned, []);
});

test("hrefWithOpenNonce appends ?open= when the href has no query", () => {
  const out = hrefWithOpenNonce("/agent");
  assert.match(out, /^\/agent\?open=.+/);
});

test("hrefWithOpenNonce appends &open= when the href already has a query", () => {
  const out = hrefWithOpenNonce("/agent?session=abc");
  assert.match(out, /^\/agent\?session=abc&open=.+/);
});
