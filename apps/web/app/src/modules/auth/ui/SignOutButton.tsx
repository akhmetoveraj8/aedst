"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/modules/auth/lib/auth-actions";
import { useRouter } from "@/shared/i18n/navigation";
import { useAuth } from "@/shared/lib/auth/AuthProvider";
import { runBeforeSignOut } from "@/shared/lib/auth/sign-out-hooks";
import { Button } from "@/shared/ui/button";

export function SignOutButton() {
  const t = useTranslations("auth");
  const { signOut } = useAuth();
  const router = useRouter();
  const logout = useMutation({
    meta: { silent: true },
    // Cleanup that needs the session (push unregistration, …) runs first.
    mutationFn: async () => {
      await runBeforeSignOut();
      return await logoutAction();
    },
    // Signed out locally whether or not the IdP call succeeded: the cookies
    // are already cleared by then. With an end_session endpoint the browser
    // also ends the IdP session, which sends it back to the site root.
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
