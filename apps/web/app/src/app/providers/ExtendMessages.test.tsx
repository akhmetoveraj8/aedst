import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import { ExtendMessages } from "@/app/providers/ExtendMessages";

function Probe() {
  const common = useTranslations("common.locale");
  const tasks = useTranslations("tasks.dashboard");
  return (
    <p>
      {common("label")}|{tasks("title")}
    </p>
  );
}

describe("ExtendMessages", () => {
  it("adds a module's catalog to what the parent provider sent", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ common: { locale: { label: "Language" } } }}
      >
        <ExtendMessages messages={{ tasks: { dashboard: { title: "Tasks" } } }}>
          <Probe />
        </ExtendMessages>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Language|Tasks")).toBeInTheDocument();
  });
});
