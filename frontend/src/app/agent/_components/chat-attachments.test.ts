import { describe, expect, it } from "vitest";
import {
  attachmentDedupKey,
  attachmentPreviewKind,
  filesFromDataTransfer,
  isImageAttachment,
} from "./chat-attachments";

describe("chat attachments", () => {
  it("dedupes one pasted file exposed through files and items", () => {
    const first = new File(["same image"], "image.png", {
      type: "image/png",
      lastModified: 1,
    });
    const second = new File(["same image"], "image.png", {
      type: "image/png",
      lastModified: 2,
    });
    const transfer = {
      types: ["Files"],
      files: [first],
      items: [{ kind: "file", getAsFile: () => second }],
    } as unknown as DataTransfer;

    expect(filesFromDataTransfer(transfer)).toEqual([first]);
  });

  it("uses stable attachment keys and identifies inline image previews", () => {
    expect(
      attachmentDedupKey({
        name: "Image.PNG",
        type: "image/png",
        size: 123,
      }),
    ).toBe("file:image.png:image/png:123");
    expect(
      isImageAttachment({
        type: "image/png",
        mode: "data-url",
        content: "data:image/png;base64,abc",
        previewKind: "image",
        previewUrl: "data:image/png;base64,abc",
      }),
    ).toBe(true);
  });

  it("classifies media attachments for rich previews", () => {
    expect(attachmentPreviewKind("image/png", "image.png")).toBe("image");
    expect(attachmentPreviewKind("video/mp4", "clip.mp4")).toBe("video");
    expect(attachmentPreviewKind("application/pdf", "paper.pdf")).toBe("pdf");
    expect(attachmentPreviewKind("", "paper.pdf")).toBe("pdf");
    expect(attachmentPreviewKind("application/octet-stream", "archive.bin")).toBeUndefined();
  });
});
