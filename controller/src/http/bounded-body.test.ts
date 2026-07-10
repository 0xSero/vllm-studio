import { expect, test } from "bun:test";
import { boundedFormData, readBoundedRequestBody, RequestBodyTooLargeError } from "./bounded-body";

test("preserves bounded request bytes", async () => {
  const bytes = Uint8Array.from([0, 255, 82, 73, 70, 70]);
  const body = await readBoundedRequestBody(
    new Request("http://localhost/upload", { method: "POST", body: bytes }),
    bytes.length,
  );
  expect(new Uint8Array(body)).toEqual(bytes);
});

test("rejects chunked bodies beyond the limit", async () => {
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(Uint8Array.from([1, 2]));
        controller.enqueue(Uint8Array.from([3, 4]));
        controller.close();
      },
    }),
  });
  await expect(readBoundedRequestBody(request, 3)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
});

test("parses multipart only after enforcing its byte boundary", async () => {
  const form = new FormData();
  form.set("name", "Sero");
  form.set("reference", new File(["voice"], "voice.wav", { type: "audio/wav" }));
  const request = new Request("http://localhost/v1/audio/voices", {
    method: "POST",
    body: form,
  });
  const length = Number(request.headers.get("content-length") ?? 0);
  const parsed = await boundedFormData(request, Math.max(length, 1024));
  expect(parsed.get("name")).toBe("Sero");
  expect(parsed.get("reference")).toBeInstanceOf(File);
});
