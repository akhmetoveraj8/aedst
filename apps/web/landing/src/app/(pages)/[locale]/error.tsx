"use client";

import { usePathname } from "next/navigation";
import { useErrorMessages } from "@/app/providers/error-messages";

/**
 * Route error boundary (a client component by Next's contract). Strings come
 * from the layout through `ErrorMessagesProvider`. "Try again" is a link that
 * reloads the page: on a static site a fresh document is the retry, and a
 * link needs no event handler; it is a text link so the kit button (and
 * base-ui with it) stays out of every first load. No error reporting SDK here.
 */
export default function LocaleError() {
  const messages = useErrorMessages();
  const pathname = usePathname();

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="font-semibold text-2xl">{messages?.title}</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {messages?.description}
      </p>
      <a
        href={pathname}
        className="font-medium text-sm underline underline-offset-4"
      >
        {messages?.tryAgain}
      </a>
    </div>
  );
}
