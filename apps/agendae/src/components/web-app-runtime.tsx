import type { PropsWithChildren } from "react";

import { AppUpdateChecker } from "@/src/components/app-update-checker";
import { InactivityLogoutGuard } from "@/src/components/inactivity-logout-guard";
import { RouteAccessGuard } from "@/src/components/route-access-guard";
import { DesktopTooltips } from "@/src/components/ui/desktop-tooltips";

export default function WebAppRuntime({ children }: PropsWithChildren) {
  return (
    <InactivityLogoutGuard>
      <AppUpdateChecker />
      <DesktopTooltips />
      <RouteAccessGuard>{children}</RouteAccessGuard>
    </InactivityLogoutGuard>
  );
}
