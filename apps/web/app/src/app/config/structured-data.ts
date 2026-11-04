import { siteConfig } from "./seo";

/**
 * Typed schema.org JSON-LD builders. Hand-written (a handful of types, no
 * runtime dependency); `schema-dts` was evaluated and not adopted, see
 * docs/content/library-first/web.md. Every entity gets a stable `@id`
 * derived from the canonical origin so pages can reference each other
 * (WebSite.publisher -> Organization) inside one `@graph`.
 */
type JsonLdNode = { "@type": string; "@id"?: string } & Record<string, unknown>;

const SCHEMA_CONTEXT = "https://schema.org";

function absolute(path: string): string {
  return new URL(path, siteConfig.url).toString();
}

/** Stable identifiers: `<origin>/#organization`, `<origin>/#website`. */
export const entityIds = {
  organization: () => absolute("/#organization"),
  website: () => absolute("/#website"),
  webApplication: (locale: string) => absolute(`/${locale}#webapp`),
} as const;

/** Wrap nodes into one document: `{ "@context", "@graph": [...] }`. */
export function graph(...nodes: JsonLdNode[]) {
  return { "@context": SCHEMA_CONTEXT, "@graph": nodes };
}

export function organization(): JsonLdNode {
  const { legalName, logo, sameAs } = siteConfig.organization;
  return {
    "@type": "Organization",
    "@id": entityIds.organization(),
    name: siteConfig.name,
    legalName,
    url: absolute("/"),
    logo: { "@type": "ImageObject", url: absolute(logo) },
    ...(sameAs.length > 0 ? { sameAs: [...sameAs] } : {}),
  };
}

export function webSite(args: { inLanguage: string }): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": entityIds.website(),
    name: siteConfig.name,
    url: absolute("/"),
    inLanguage: args.inLanguage,
    publisher: { "@id": entityIds.organization() },
  };
}

export function webApplication(args: {
  locale: string;
  inLanguage: string;
  name: string;
  description: string;
}): JsonLdNode {
  return {
    "@type": "WebApplication",
    "@id": entityIds.webApplication(args.locale),
    name: args.name,
    description: args.description,
    url: absolute(`/${args.locale}`),
    inLanguage: args.inLanguage,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Any",
    publisher: { "@id": entityIds.organization() },
  };
}

/** `items` are in order, first = top of the trail; `path` is an app path like `/en/about`. */
export function breadcrumbList(
  items: ReadonlyArray<{ name: string; path: string }>,
): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}

export function faqPage(
  questions: ReadonlyArray<{ question: string; answer: string }>,
): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

export function article(args: {
  path: string;
  headline: string;
  description?: string;
  inLanguage: string;
  datePublished: string;
  dateModified?: string;
}): JsonLdNode {
  return {
    "@type": "Article",
    "@id": absolute(`${args.path}#article`),
    headline: args.headline,
    ...(args.description ? { description: args.description } : {}),
    url: absolute(args.path),
    inLanguage: args.inLanguage,
    datePublished: args.datePublished,
    dateModified: args.dateModified ?? args.datePublished,
    author: { "@id": entityIds.organization() },
    publisher: { "@id": entityIds.organization() },
  };
}
