import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { Flow } from "@/components/flow/flow";
import { OpenAPIPage } from "@/components/openapi/openapi-page";

// `OpenAPIPage` renders one generated OpenAPI document interactively (docs/scripts/openapi-pages.mjs).
// `Flow` draws an interactive diagram (React Flow); see src/components/flow/flow.tsx.
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Tab,
    Tabs,
    Step,
    Steps,
    Flow,
    OpenAPIPage,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
