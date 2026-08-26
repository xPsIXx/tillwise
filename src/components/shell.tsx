import { Link, useRouterState } from "@tanstack/react-router";
import { House, Images, ReceiptText, ScanLine, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: House },
  { to: "/scan", label: "Scan", icon: ScanLine },
  { to: "/trips", label: "Trips", icon: ReceiptText },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 px-4 pr-16 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md bg-fg">
              <ReceiptMark />
            </span>
            <span className="font-display text-lg tracking-tight">Tillwise</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/shots"
              aria-label="Pictures"
              className={cn(
                "grid size-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-fg",
                pathname.startsWith("/shots") && "text-fg",
              )}
            >
              <Images className="size-5" />
            </Link>
            <Link
              to="/settings"
              aria-label="Settings"
              className={cn(
                "grid size-11 place-items-center rounded-lg text-muted hover:bg-elevated hover:text-fg",
                pathname.startsWith("/settings") && "text-fg",
              )}
            >
              <SlidersHorizontal className="size-5" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
          <div className="mx-auto grid max-w-3xl grid-cols-3 px-2 pt-1">
            {NAV.map((item) => {
              const active =
                item.to === "/"
                  ? pathname === "/"
                  : pathname === item.to || pathname.startsWith(`${item.to}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                    active ? "text-fg" : "text-subtle",
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
    </div>
  );
}

function ReceiptMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <rect x="3" y="2" width="10" height="12" rx="1.2" fill="#12110e" />
      <rect x="5" y="5" width="6" height="1" fill="#8fa37a" />
      <rect x="5" y="7.5" width="4.5" height="1" fill="#12110e" opacity="0.35" />
      <rect x="5" y="10" width="5" height="1" fill="#12110e" opacity="0.35" />
    </svg>
  );
}
