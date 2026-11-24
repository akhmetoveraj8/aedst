import { describe, expect, it } from "vitest";
import {
  breadcrumbList,
  faqPage,
  graph,
  organization,
  softwareApplication,
  webSite,
} from "@/app/config/structured-data";

describe("structured data", () => {
  it("wraps nodes in one @graph and links WebSite to the Organization by @id", () => {
    const doc = graph(organization(), webSite({ inLanguage: "en" }));
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@graph"]).toHaveLength(2);
    expect(doc["@graph"][1]?.publisher).toEqual({
      "@id": "http://localhost:3002/#organization",
    });
  });

  it("builds a SoftwareApplication that points at the app origin", () => {
    const node = softwareApplication({
      locale: "en",
      inLanguage: "en",
      name: "AEDST",
      description: "d",
      appUrl: "http://localhost:3000/en",
    });
    expect(node["@type"]).toBe("SoftwareApplication");
    expect(node.url).toBe("http://localhost:3000/en");
    expect(node.offers).toBeUndefined();
  });

  it("builds FAQPage questions with accepted answers", () => {
    const node = faqPage([{ question: "Q?", answer: "A." }]);
    expect(node["@type"]).toBe("FAQPage");
    expect(node.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "Q?",
        acceptedAnswer: { "@type": "Answer", text: "A." },
      },
    ]);
  });

  it("numbers breadcrumb items from 1 with absolute URLs", () => {
    const node = breadcrumbList([
      { name: "Home", path: "/en" },
      { name: "Privacy", path: "/en/privacy" },
    ]);
    expect(node.itemListElement).toMatchObject([
      { position: 1, item: "http://localhost:3002/en" },
      { position: 2, item: "http://localhost:3002/en/privacy" },
    ]);
  });
});
