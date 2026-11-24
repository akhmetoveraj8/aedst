export type FaqEntry = { key: string; question: string; answer: string };

/**
 * The FAQ as native `<details>` / `<summary>`: disclosure, keyboard and
 * screen-reader behaviour come from the platform, so the section ships no
 * JavaScript (the base-ui accordion cost about 20 KB of first load). Every
 * answer is in the server HTML, closed or open, so crawlers, answer engines
 * and find-in-page see the full text; it mirrors the FAQPage JSON-LD.
 * `name` makes the group exclusive: opening one answer closes the others.
 */
export function FaqAccordion({ entries }: { entries: readonly FaqEntry[] }) {
  return (
    <div className="flex w-full flex-col">
      {entries.map((entry) => (
        <details
          key={entry.key}
          name="faq"
          className="group border-b last:border-b-0"
        >
          {/* ui-kit-ignore: zero-JS FAQ by decision (header comment); kit Accordion costs ~20 KB */}
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-lg py-2.5 text-start font-medium text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            {entry.question}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <p className="pb-2.5 text-sm">{entry.answer}</p>
        </details>
      ))}
    </div>
  );
}
