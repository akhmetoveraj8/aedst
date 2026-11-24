import { siteConfig } from "./seo";

/**
 * Typed schema.org JSON-LD builders (hand-written: a handful of types, no
 * runtime dependency). Every entity has a stable `@id` derived from the
 * canonical origin so nodes can reference each other inside one `@graph`.
 */
type JsonLdNode = { "@type": string; "@id"?: string } & Record<string, unknown>;

const SCHEMA_CONTEXT = "https://schema.org";

function absolute(path: string): string {
  return new URL(path, siteConfig.url).toString();
}

export const entityIds = {
  organization: () => absolute("/#organization"),
  website: () => absolute("/#website"),
  application: (locale: string) => absolute(`/${locale}#application`),
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

/** The product being marketed. No `offers`: pricing is a placeholder. */
export function softwareApplication(args: {
  locale: string;
  inLanguage: string;
  name: string;
  description: string;
  /** Absolute URL of the signed-in app. */
  appUrl: string;
}): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": entityIds.application(args.locale),
    name: args.name,
    description: args.description,
    url: args.appUrl,
    inLanguage: args.inLanguage,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Any",
    publisher: { "@id": entityIds.organization() },
  };
}

/** `path` is a site path like `/en/privacy`; first item is the top of the trail. */
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
