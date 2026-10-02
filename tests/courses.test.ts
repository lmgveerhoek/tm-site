import { expect, test } from "bun:test";
import { mounted } from "../hub/public/views/courses.js";

test("course cards count recordings and accept older document-only manifests", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const cards = [{ dataset: { slug: "asa" }, textContent: "" }, { dataset: { slug: "dsd" }, textContent: "" }];
  globalThis.document = { querySelectorAll: () => cards } as unknown as Document;
  globalThis.fetch = async (url) => new Response(JSON.stringify({
    docs: [1], updated: "2026-10-01T10:00:00Z",
    ...(String(url).startsWith("dsd/") ? { videos: [1, 2] } : {}),
  }));
  try {
    mounted();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(cards[0].textContent).toBe("1 document · bijgewerkt op 1 oktober 2026");
    expect(cards[1].textContent).toBe("1 document · 2 opnames · bijgewerkt op 1 oktober 2026");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});
