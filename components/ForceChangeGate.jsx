"use client";
// Forces a user with mustChangePassword=true onto /account/change-password
// before they can use the rest of the dashboard. The change-password page
// itself is allowed (no redirect loop), and the top-bar Logout still works
// because this gate wraps only the page body, not the shell.
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const CHANGE_PATH = "/account/change-password";

export default function ForceChangeGate({ mustChange, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const onChangePage = pathname === CHANGE_PATH;

  useEffect(() => {
    if (mustChange && !onChangePage) router.replace(CHANGE_PATH);
  }, [mustChange, onChangePage, router]);

  if (mustChange && !onChangePage) return null; // avoid flashing protected content
  return children;
}
