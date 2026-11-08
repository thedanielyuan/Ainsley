import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import test from "node:test";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { extractText, getDocumentProxy, getResolvedPDFJS } from "unpdf";

// Run against an already-running development server. Only synthetic files are sent;
// these requests do not add files or chats to anyone's library.
const endpoint = new URL("/api/materials/preview", process.env.AINSLEY_TEST_URL ?? "http://localhost:3000");
const mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const fixture = await readFile(new URL("./fixtures/formatting-hidden-order.pptx", import.meta.url));
const originalParts = unzipSync(fixture);
const externalImage = {
  ...originalParts,
  "ppt/slides/_rels/slide1.xml.rels": strToU8(strFromU8(originalParts["ppt/slides/_rels/slide1.xml.rels"]).replace("</Relationships>",
    '<Relationship Id="externalPreviewTest" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.test/image.png" TargetMode="External"/></Relationships>')),
};
const post = (body, headers = {}) => fetch(endpoint, {
  method: "POST", body,
  headers: { "Content-Type": mime, Origin: endpoint.origin, ...headers },
  signal: AbortSignal.timeout(90_000),
});

test("slides retain visual content, manifest order and hidden slides", async () => {
  const response = await post(fixture);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
  const pdf = await getDocumentProxy(bytes);
  try {
    assert.equal(pdf.numPages, 3, "hidden middle slide must not disappear or shift citations");
    const { text } = await extractText(pdf, { mergePages: false });
    ["CHARLIE FORMAT TEST", "BRAVO HIDDEN FORMAT TEST", "ALPHA FORMAT TEST"].forEach((title, index) => {
      assert.ok(text[index].includes(title), `page ${index + 1} must follow the reordered presentation manifest`);
    });
    const { OPS } = await getResolvedPDFJS();
    const page = await pdf.getPage(3);
    const operators = await page.getOperatorList();
    const imageOperations = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
    assert.ok(operators.fnArray.some((operation) => imageOperations.has(operation)), "embedded diagram must remain an image in the PDF");
  } finally {
    await pdf.loadingTask.destroy();
  }
});

for (const [name, body, headers, status] of [
  ["empty upload", new Uint8Array(), {}, 400],
  ["ordinary text", "not a presentation", {}, 422],
  ["truncated ZIP", "PK\x03\x04incomplete", {}, 422],
  ["ZIP without slides", zipSync({ "readme.txt": strToU8("no presentation") }), {}, 422],
  ["wrong content type", fixture, { "Content-Type": "text/plain" }, 415],
  ["foreign origin", fixture, { Origin: "https://example.test" }, 403],
  ["macro payload", zipSync({ ...originalParts, "ppt/vbaProject.bin": strToU8("test") }), {}, 422],
  ["external image relationship", zipSync(externalImage), {}, 422],
]) {
  test(`rejects ${name}`, async () => {
    const response = await post(body, headers);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
    assert.match(response.headers.get("cache-control"), /no-store/);
  });
}

test("rejects an oversized declared body before buffering it", async () => {
  // node:http permits testing the early Content-Length guard without allocating a
  // 32 MB fixture or fetch rejecting the intentionally mismatched length itself.
  const status = await new Promise((resolve, reject) => {
    const request = (endpoint.protocol === "https:" ? httpsRequest : httpRequest)(endpoint, {
      method: "POST",
      headers: { "Content-Type": mime, Origin: endpoint.origin, "Content-Length": 32 * 1024 * 1024 + 1 },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Preview size guard timed out")));
    request.on("error", reject);
    request.end();
  });
  assert.equal(status, 413);
});
