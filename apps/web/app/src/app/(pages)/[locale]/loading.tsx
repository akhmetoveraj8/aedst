import { PageMain } from "@/shared/lib/layout/page-main";
import { Spinner } from "@/shared/ui/spinner";

export default function LocaleLoading() {
  return (
    <PageMain className="items-center justify-center py-24">
      <Spinner className="size-6" />
    </PageMain>
  );
}
