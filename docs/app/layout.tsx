import type { Metadata } from "next";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import type { ReactNode } from "react";
import "nextra-theme-docs/style.css";
import { SITE_DESCRIPTION, SITE_NAME, configuredDocsUrl, docsLicense, docsRepositoryBase } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: configuredDocsUrl() ? new URL(configuredDocsUrl() as string) : undefined,
  title: {
    default: SITE_NAME,
    template: "%s — AEDST docs",
  },
  description: SITE_DESCRIPTION,
};

// Unset NEXT_PUBLIC_DOCS_REPO_BASE: no edit link is rendered.
const docsRepositoryBaseUrl = docsRepositoryBase();


const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 700 }}>
        AEDST <span style={{ opacity: 0.6, fontWeight: 400 }}>docs</span>
      </span>
    }
  />
);

const footer = (
  <Footer>
    © {new Date().getFullYear()} AEDST. {docsLicense()}
  </Footer>
);

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase={docsRepositoryBaseUrl}
          footer={footer}
          editLink={docsRepositoryBaseUrl ? "Edit this page on GitHub" : null}
          feedback={docsRepositoryBaseUrl ? undefined : { content: null }}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
