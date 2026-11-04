"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { useRouter } from "@/shared/i18n/navigation";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { requestLogout } from "@/shared/lib/auth/logout";
import { Button } from "@/shared/ui/button";

export function AdminSignOutButton() {
  const t = useTranslations("admin");
  const { signOut } = useAuth();
  const router = useRouter();
  const logout = useMutation({
    meta: { silent: true },
    mutationFn: () => requestLogout(),
    // Signed out locally whether or not the IdP call succeeded (the BFF clears
    // the cookies first). With an end_session endpoint the browser also
    // ends the IdP session and returns to the site root.
    onSettled: (result) => {
      signOut();
      if (result?.endSessionUrl) {
        window.location.assign(result.endSessionUrl);
        return;
      }
      router.replace("/");
      router.refresh();
    },
  });

  return (
    <Button
      variant="outline"
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
    >
      {t("signOut")}
    </Button>
  );
}
