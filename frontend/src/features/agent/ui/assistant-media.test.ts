import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assistantMediaKind,
  assistantMediaSource,
  cleanFileReference,
  remarkLocalMediaReferences,
} from "./assistant-media";

describe("assistant response media", () => {
  test("classifies local image, video, audio, and SVG references", () => {
    assert.equal(assistantMediaKind("/tmp/result.png"), "image");
    assert.equal(assistantMediaKind("./diagram.svg"), "image");
    assert.equal(assistantMediaKind("outputs/demo.mp4"), "video");
    assert.equal(assistantMediaKind("~/Music/answer.wav"), "audio");
    assert.equal(assistantMediaKind("https://example.com/result.png"), null);
    assert.equal(assistantMediaKind("src/index.ts"), null);
  });

  test("builds authenticated raw-file URLs for relative and absolute paths", () => {
    assert.equal(
      assistantMediaSource("output/result.png", "/Users/me/project"),
      "/api/agent/fs/raw?cwd=%2FUsers%2Fme%2Fproject&path=output%2Fresult.png",
    );
    assert.equal(
      assistantMediaSource("/Users/me/Desktop/demo.mp4", "/Users/me/project"),
      "/api/agent/fs/raw?cwd=%2FUsers%2Fme%2FDesktop&path=demo.mp4",
    );
  });

  test("decodes file URLs before opening or serving them", () => {
    assert.equal(
      cleanFileReference("file:///Users/me/Desktop/a%20demo.svg"),
      "/Users/me/Desktop/a demo.svg",
    );
  });

  test("turns unformatted media paths into markdown links without touching remote URLs", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value:
                "Rendered /Users/me/out/image.svg and clips/demo.mp4, not https://example.com/a.png.",
            },
          ],
        },
      ],
    };
    remarkLocalMediaReferences()(tree);
    const children = (tree.children[0]?.children ?? []) as Array<{ type: string; url?: string }>;
    assert.deepEqual(
      children.filter((node) => node.type === "link").map((node) => node.url),
      ["/Users/me/out/image.svg", "clips/demo.mp4"],
    );
  });

  test("does not rewrite media-looking paths inside code", () => {
    const tree = {
      type: "root",
      children: [{ type: "code", value: "ffmpeg -i clips/demo.mp4" }],
    };
    remarkLocalMediaReferences()(tree);
    assert.deepEqual(tree.children, [{ type: "code", value: "ffmpeg -i clips/demo.mp4" }]);
  });
});
