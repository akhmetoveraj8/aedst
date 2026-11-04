import { describe, expect, it } from "vitest";
import {
  article,
  breadcrumbList,
  entityIds,
  faqPage,
  graph,
  organization,
  webApplication,
  webSite,
} from "./structured-data";

describe("structured-data", () => {
  it("derives stable @ids from the canonical origin", () => {
    expect(entityIds.organization()).toBe(
      "http://localhost:3000/#organization",
    );
    expect(entityIds.website()).toBe("http://localhost:3000/#website");
    expect(organization()["@id"]).toBe(entityIds.organization());
  });

  it("describes the organisation with an absolute logo and no empty sameAs", () => {
    const node = organization();

    expect(node).toMatchObject({
      "@type": "Organization",
      name: "AEDST",
      legalName: "AEDST",
      logo: {
        "@type": "ImageObject",
        url: "http://localhost:3000/icons/icon-512.png",
      },
    });
    expect(node).not.toHaveProperty("sameAs");
  });

  it("links the website to its publisher by @id", () => {
    expect(webSite({ inLanguage: "tg" })).toMatchObject({
      "@type": "WebSite",
      inLanguage: "tg",
      publisher: { "@id": entityIds.organization() },
    });
  });

  it("wraps nodes into one @graph document", () => {
    const doc = graph(organization(), webSite({ inLanguage: "en" }));

    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@graph"].map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
    ]);
  });

  it("builds a localized WebApplication", () => {
    expect(
      webApplication({
        locale: "tj",
        inLanguage: "tg",
        name: "AEDST",
        description: "d",
      }),
    ).toMatchObject({
      "@id": "http://localhost:3000/tj#webapp",
      url: "http://localhost:3000/tj",
      inLanguage: "tg",
    });
  });

  it("numbers breadcrumb items from 1 with absolute URLs", () => {
    expect(
      breadcrumbList([
        { name: "Home", path: "/en" },
        { name: "FAQ", path: "/en/faq" },
      ]),
    ).toMatchObject({
      itemListElement: [
        { position: 1, item: "http://localhost:3000/en" },
        { position: 2, item: "http://localhost:3000/en/faq" },
      ],
    });
  });

  it("builds FAQPage questions with accepted answers", () => {
    expect(faqPage([{ question: "Q?", answer: "A." }])).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q?", acceptedAnswer: { text: "A." } },
      ],
    });
  });

  it("builds an Article that defaults dateModified to datePublished", () => {
    expect(
      article({
        path: "/en/changelog",
        headline: "H",
        inLanguage: "en",
        datePublished: "2026-10-08",
      }),
    ).toMatchObject({
      "@id": "http://localhost:3000/en/changelog#article",
      dateModified: "2026-10-08",
      author: { "@id": entityIds.organization() },
    });
  });
});
