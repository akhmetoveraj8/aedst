import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../mdx-components";

export const generateStaticParams = generateStaticParamsFor("mdxPath");

// Every page is known at build time (one per file in content/). Anything else —
// e.g. a stale service worker from another app on localhost:3000 requesting
// /iman-sw.js — must be a plain 404, not an attempt to import a page that
// does not exist ("Cannot find module 'private-next-content-dir/undefined'").
export const dynamicParams = false;

type PageProps = {
  params: Promise<{ mdxPath?: string[] }>;
};

async function loadPage(mdxPath: string[] | undefined) {
  try {
    return await importPage(mdxPath ?? []);
  } catch {
    notFound();
  }
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const { metadata } = await loadPage(params.mdxPath);
  const path = (params.mdxPath ?? []).join("/");
  // Resolved against metadataBase (NEXT_PUBLIC_DOCS_URL); relative when that is unset.
  return { ...metadata, alternates: { ...metadata.alternates, canonical: `/${path}` } };
}

const Wrapper = getMDXComponents().wrapper;

export default async function Page(props: PageProps) {
  const params = await props.params;
  const { default: MDXContent, toc, metadata, sourceCode } = await loadPage(params.mdxPath);
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}
