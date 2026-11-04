/**
 * AI crawler user agents, split by what they do with the content.
 *
 * - Answer engines fetch a page to cite it in a live answer (search-style
 *   retrieval, user-triggered fetches). Allowing them is what makes the site
 *   citable by ChatGPT, Claude, Perplexity and Apple Intelligence.
 * - Training crawlers collect content for model training or bulk datasets.
 *   Blocking them does not affect citations or classic search ranking.
 *
 * Policy per group lives in `siteConfig.aiCrawlers` (config/seo.ts); the
 * rules are emitted by `app/robots.ts`. See docs/content/web/seo-geo.md.
 */

export const answerEngineBots = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
] as const;

export const trainingBots = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
] as const;

export type CrawlerPolicy = "allow" | "deny";

export type AiCrawlerConfig = {
  answerEngines: CrawlerPolicy;
  trainingCrawlers: CrawlerPolicy;
};
