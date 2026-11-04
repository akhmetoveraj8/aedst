"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/modules/admin/lib/auth-actions";
import { useRouter } from "@/shared/i18n/navigation";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { Button } from "@/shared/ui/button";

export function AdminSignOutButton() {
  const t = useTranslations("admin");
  const { signOut } = useAuth();
  const router = useRouter();
  const logout = useMutation({
    meta: { silent: true },
    mutationFn: () => logoutAction(),
    // Signed out locally whether or not the IdP call succeeded (the cookies
    // are already cleared). With an end_session endpoint the browser also
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
