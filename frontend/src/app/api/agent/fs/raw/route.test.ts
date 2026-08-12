import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { parseByteRange } from "./byte-range";
import { GET } from "./route";

describe("raw file byte ranges", () => {
  test("parses bounded, open-ended, and suffix ranges", () => {
    assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
    assert.deepEqual(parseByteRange("bytes=-12", 100), { start: 88, end: 99 });
    assert.deepEqual(parseByteRange("bytes=90-120", 100), { start: 90, end: 99 });
  });

  test("distinguishes absent and invalid ranges", () => {
    assert.equal(parseByteRange(null, 100), undefined);
    assert.equal(parseByteRange("bytes=100-101", 100), null);
    assert.equal(parseByteRange("bytes=20-10", 100), null);
    assert.equal(parseByteRange("bytes=0-1,4-5", 100), null);
  });
});

describe("raw response media", () => {
  test("streams seekable video with the correct range headers", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-studio-media-"));
    try {
      await writeFile(path.join(cwd, "clip.mp4"), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
      const request = new NextRequest(
        `http://localhost/api/agent/fs/raw?cwd=${encodeURIComponent(cwd)}&path=clip.mp4`,
        { headers: { range: "bytes=2-5" } },
      );
      const response = await GET(request);
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-type"), "video/mp4");
      assert.equal(response.headers.get("content-range"), "bytes 2-5/8");
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4, 5]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("serves SVG as an inline image with a restrictive document policy", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-studio-media-"));
    try {
      await writeFile(
        path.join(cwd, "diagram.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      );
      const request = new NextRequest(
        `http://localhost/api/agent/fs/raw?cwd=${encodeURIComponent(cwd)}&path=diagram.svg`,
      );
      const response = await GET(request);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/svg+xml");
      assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
      assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
      assert.match(await response.text(), /^<svg/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
