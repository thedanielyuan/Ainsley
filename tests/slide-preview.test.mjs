import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
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
const post = (body, headers = {}) => fetch(endpoint, {
  method: "POST", body,
  headers: { "Content-Type": mime, Origin: endpoint.origin, ...headers },
  signal: AbortSignal.timeout(90_000),
});

/** Whether a page of the rendered PDF draws an image (slide 1, page 3, holds the embedded diagram). */
async function drawsImage(pdf, pageNumber) {
  const { OPS } = await getResolvedPDFJS();
  const operators = await (await pdf.getPage(pageNumber)).getOperatorList();
  const imageOperations = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
  return operators.fnArray.some((operation) => imageOperations.has(operation));
}

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
    assert.ok(await drawsImage(pdf, 3), "embedded diagram must remain an image in the PDF");
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test("linked pictures show their embedded copy, and their links are never fetched", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const relationship = (id, target) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}" TargetMode="External"/>`;
  // A picture with only a link (no embedded copy) beside the diagram.
  const linkOnly = '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Linked picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:link="rIdOnlyLinked"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="548640" y="3657600"/><a:ext cx="1828800" cy="1097280"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  const deck = zipSync({
    ...originalParts,
    // The diagram as PowerPoint's "Insert and Link" saves it: embedded, and linked to its original file.
    "ppt/slides/slide1.xml": strToU8(strFromU8(originalParts["ppt/slides/slide1.xml"])
      .replace('<a:blip r:embed="rId2"/>', '<a:blip r:embed="rId2" r:link="rIdLinked"/>')
      .replace("</p:spTree>", `${linkOnly}</p:spTree>`)),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(strFromU8(originalParts["ppt/slides/_rels/slide1.xml.rels"]).replace("</Relationships>",
      relationship("rIdLinked", `http://127.0.0.1:${server.address().port}/diagram.png`) +
      relationship("rIdOnlyLinked", `http://127.0.0.1:${server.address().port}/only-linked.png`) + "</Relationships>")),
  });
  try {
    const response = await post(deck);
    assert.equal(response.status, 200, await response.clone().text());
    const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
    try {
      assert.equal(pdf.numPages, 3);
      assert.ok(await drawsImage(pdf, 3), "the embedded copy of a linked picture must be drawn");
    } finally {
      await pdf.loadingTask.destroy();
    }
    assert.deepEqual(requests, [], "a linked file must not be fetched");
  } finally {
    server.close();
  }
});

test("slides in sections are counted once", async () => {
  // PowerPoint saves sections as a second list of the same slides, by number, in an extension list.
  const presentation = strFromU8(originalParts["ppt/presentation.xml"]);
  const numbers = [...presentation.matchAll(/<p:sldId id="(\d+)"/g)].map((match) => match[1]);
  const sections = '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
    `<p14:section name="Week 1" id="{6E2B7C1A-4F0D-4C5B-9C27-2A1D3E5F7B90}"><p14:sldIdLst>${numbers.map((n) => `<p14:sldId id="${n}"/>`).join("")}</p14:sldIdLst></p14:section>` +
    "</p14:sectionLst></p:ext></p:extLst>";
  const response = await post(zipSync({
    ...originalParts,
    "ppt/presentation.xml": strToU8(presentation.replace("</p:presentation>", `${sections}</p:presentation>`)),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
  try {
    assert.equal(pdf.numPages, 3);
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
