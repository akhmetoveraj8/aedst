import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DataTable, type DataTableColumn } from "@/shared/ui/data-table";

interface Payment {
  id: string;
  email: string;
  status: string;
  amount: number;
}

const payments: Payment[] = [
  { id: "p1", email: "ken@example.com", status: "Paid", amount: 316 },
  { id: "p2", email: "abe@example.com", status: "Pending", amount: 242 },
  { id: "p3", email: "monserrat@example.com", status: "Paid", amount: 837 },
];

const columns: DataTableColumn<Payment>[] = [
  { accessorKey: "email", header: "Email" },
  { accessorKey: "status", header: "Status", enableSorting: false },
  { accessorKey: "amount", header: "Amount" },
];

function PaymentsTable(props: {
  data: Payment[] | undefined;
  isLoading?: boolean;
}) {
  return (
    <DataTable
      label="Payments"
      columns={columns}
      emptyText="No payments."
      loadingText="Loading payments"
      {...props}
    />
  );
}

const meta = {
  title: "UI/DataTable",
  component: PaymentsTable,
  args: { data: payments },
} satisfies Meta<typeof PaymentsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { data: [] } };

export const Loading: Story = { args: { data: undefined, isLoading: true } };
