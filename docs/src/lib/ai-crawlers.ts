// Same two named lists as the web app AI-bot policy (keep the names identical).
//
// answer:   fetch pages on behalf of a user or build an answer-engine index; allowed.
// training: collect content for model training; disallowed by default because the owner has
//           not chosen a licence for this material. Set DOCS_ALLOW_AI_TRAINING=true to allow.

export const aiCrawlers = {
  answer: ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Applebot"],
  training: ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Amazonbot", "meta-externalagent"],
} as const;
