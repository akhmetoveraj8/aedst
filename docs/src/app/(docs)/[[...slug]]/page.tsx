import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { TOCItemType } from "fumadocs-core/toc";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { docsLicense, docsRepositoryBase } from "@/lib/site";
import { source } from "@/lib/source";

type PageProps = { params: Promise<{ slug?: string[] }> };

// Every page is known at build time (one per file in content/); anything else is a plain 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams();
}

export default async function Page(props: PageProps) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // Unset NEXT_PUBLIC_DOCS_REPO_BASE: no edit link is rendered.
  const repoBase = docsRepositoryBase();
  // Generated OpenAPI pages carry their table of contents (one entry per operation) in front matter.
  const openapiToc = page.data._openapi?.toc as TOCItemType[] | undefined;

  return (
    <DocsPage toc={openapiToc ?? page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        {/* Absolute site paths (/server/modules) work as they did; relative file links resolve too. */}
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
      {repoBase ? (
        <a
          className="mt-8 text-sm text-fd-muted-foreground underline"
          href={`${repoBase.replace(/\/+$/, "")}/${encodeURI(page.path)}`}
          rel="noreferrer"
        >
          Edit this page on GitHub
        </a>
      ) : null}
      <p className="mt-6 text-xs text-fd-muted-foreground">
        © {new Date().getFullYear()} AEDST. {docsLicense()}
      </p>
    </DocsPage>
  );
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
  };
}
