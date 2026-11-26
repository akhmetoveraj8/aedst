import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiTest,
  type AiTestProps,
  AiTestResults,
  AiTestResultsContent,
  AiTestResultsHeader,
  AiTestResultsProgress,
  AiTestSuite,
  AiTestSuites,
  countTests,
} from "@/shared/ui/ai-test-results";

type Test = Pick<AiTestProps, "status" | "error" | "duration"> & {
  name: string;
};

const suites: { name: string; tests: Test[] }[] = [
  {
    name: "auth.test.ts",
    tests: [
      {
        name: "logs in with valid credentials",
        status: "passed",
        duration: "12 ms",
      },
      {
        name: "rejects an invalid password",
        status: "passed",
        duration: "8 ms",
      },
    ],
  },
  {
    name: "user-api.test.ts",
    tests: [
      { name: "creates a user", status: "passed" },
      {
        name: "updates a user profile",
        status: "failed",
        error:
          "Expected status 200, received 500\n  at Object.<anonymous> (src/user-api.test.ts:45:12)",
      },
      { name: "deletes a user", status: "skipped" },
    ],
  },
];

const STATUS_LABEL = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  running: "Running",
} as const;

function summary(tests: readonly Test[]): string {
  const { total, failed, skipped } = countTests(tests);
  return [
    `${total} tests`,
    failed > 0 ? `${failed} failed` : null,
    skipped > 0 ? `${skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

const all = suites.flatMap((suite) => suite.tests);
const counts = countTests(all);

const meta = {
  title: "UI/AI/TestResults",
  component: AiTestResults,
  args: { defaultOpen: true, className: "max-w-md" },
  render: (args) => (
    <AiTestResults {...args}>
      <AiTestResultsHeader
        status={counts.failed > 0 ? "failed" : "passed"}
        statusLabel={counts.failed > 0 ? "Failed" : undefined}
      >
        Ran {summary(all)}
      </AiTestResultsHeader>
      <AiTestResultsContent>
        <AiTestResultsProgress counts={counts} label="Passed" />
        <AiTestSuites>
          {suites.map((suite) => {
            const failed = countTests(suite.tests).failed > 0;
            return (
              <AiTestSuite
                key={suite.name}
                name={`${suite.name}, ${summary(suite.tests)}`}
                status={failed ? "failed" : "passed"}
              >
                {suite.tests.map((test) => (
                  <AiTest
                    key={test.name}
                    {...test}
                    statusLabel={STATUS_LABEL[test.status]}
                    copyLabel="Copy error"
                    copiedLabel="Copied"
                  />
                ))}
              </AiTestSuite>
            );
          })}
        </AiTestSuites>
      </AiTestResultsContent>
    </AiTestResults>
  ),
} satisfies Meta<typeof AiTestResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFailure: Story = {};

export const Running: Story = {
  render: (args) => (
    <AiTestResults {...args}>
      <AiTestResultsHeader status="running" statusLabel="Running">
        Running pnpm test checkout
      </AiTestResultsHeader>
      <AiTestResultsContent>
        <AiTestSuites>
          <AiTestSuite name="cart.test.ts" status="running" defaultOpen>
            <AiTest name="adds an item" status="passed" statusLabel="Passed" />
            <AiTest
              name="removes an item"
              status="running"
              statusLabel="Running"
            />
          </AiTestSuite>
        </AiTestSuites>
      </AiTestResultsContent>
    </AiTestResults>
  ),
};
