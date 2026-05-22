import { describe, expect, it } from "vitest";
import {
  attachmentDedupKey,
  attachmentPrompt,
  createAttachment,
  createProjectFileAttachment,
  filesFromDataTransfer,
  imageFileFromDataUrlText,
  imageInputFromAttachment,
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
      }),
    ).toBe(true);
  });

  it("keeps PDFs out of data-url prompt payloads", async () => {
    const attachment = await createAttachment(
      new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
    );

    expect(attachment.mode).toBe("metadata");
    expect(attachment.previewKind).toBe("pdf");
    expect(attachmentPrompt([attachment])).not.toContain("data:");
  });

  it("converts pasted image data URLs into files and keeps base64 out of visible prompt text", async () => {
    const file = imageFileFromDataUrlText("data:image/png;base64,aGVsbG8=");

    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe("image/png");

    const attachment = await createAttachment(file!);
    const imageInput = imageInputFromAttachment(attachment);
    const prompt = attachmentPrompt([attachment]);
    expect(imageInput).toEqual({ type: "image", data: "aGVsbG8=", mimeType: "image/png" });
    expect(prompt).not.toContain("aGVsbG8=");
    expect(prompt).not.toContain("data:image");
    expect(prompt).toContain("multimodal input");
  });

  it("turns selected project files into normal text attachments", () => {
    const attachment = createProjectFileAttachment({
      id: "file:src/app.ts",
      name: "app.ts",
      path: "/tmp/project/src/app.ts",
      content: "export const ok = true;",
      truncated: false,
      size: 23,
    });

    expect(attachment.mode).toBe("text");
    expect(attachment.path).toBe("/tmp/project/src/app.ts");
    expect(attachmentPrompt([attachment])).toContain("export const ok = true;");
  });
});
