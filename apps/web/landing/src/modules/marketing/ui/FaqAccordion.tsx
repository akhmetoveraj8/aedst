"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";

export type FaqEntry = { key: string; question: string; answer: string };

/**
 * Client island for the accordion behaviour only. Every answer is rendered
 * into the HTML (`keepMounted` + `hiddenUntilFound`) so crawlers, answer
 * engines and find-in-page see the full text without running JavaScript.
 */
export function FaqAccordion({ entries }: { entries: readonly FaqEntry[] }) {
  return (
    <Accordion>
      {entries.map((entry) => (
        <AccordionItem key={entry.key} value={entry.key}>
          <AccordionTrigger>{entry.question}</AccordionTrigger>
          <AccordionContent keepMounted hiddenUntilFound>
            {entry.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
