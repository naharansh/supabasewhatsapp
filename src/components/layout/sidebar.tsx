"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  GitBranch,
  Radio,
  Zap,
  Workflow,
  Image,
  Settings,
  LogOut,
  User,
  ShieldCheck,
  CreditCard,
  Check,
  AlertTriangle,
  AlertCircle,
  X,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

const alwaysVisibleNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/gallery", label: "Gallery", icon: Image },
];

const gatedNav: NavItem[] = [
  { href: "/broadcasts", label: "Broadcasts", icon: Radio },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/flows", label: "Flows", icon: Workflow, beta: true },
];

const bottomNavItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const [liveContactCount, setLiveContactCount] = useState<number | null>(null);
  const [liveMessageCount, setLiveMessageCount] = useState<number | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/counts');
      if (res.ok) {
        const data = await res.json();
        setLiveContactCount(data.contact_count);
        setLiveMessageCount(data.message_count);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000);
    window.addEventListener('counts-updated', fetchCounts);
    return () => {
      clearInterval(interval);
      window.removeEventListener('counts-updated', fetchCounts);
    };
  }, [fetchCounts]);

  const displayContactCount = liveContactCount ?? profile?.contact_count ?? 0;
  const displayMessageCount = liveMessageCount ?? profile?.message_count ?? 0;

  const allowedMenus = profile?.subscription?.features ?? null;
  const hasMenuRestrictions = Array.isArray(allowedMenus) && allowedMenus.length > 0;

  const visibleGatedNav = hasMenuRestrictions
    ? gatedNav.filter((item) => allowedMenus.includes(item.label))
    : gatedNav;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-white">
              Marbiz
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {[...alwaysVisibleNav, ...visibleGatedNav].map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    {item.beta && (
                      <span
                        aria-label="Beta feature"
                        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                      >
                        Beta
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                        className="relative flex h-2 w-2"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-4 border-t border-slate-800" />

          <ul className="flex flex-col gap-1">
            {profile?.role === "superadmin" && (
              <>
                <li>
                  <Link
                    href="/admin/users"
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      pathname === "/admin/users" || (pathname.startsWith("/admin") && !pathname.startsWith("/admin/subscriptions"))
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Users
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/subscriptions"
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      pathname.startsWith("/admin/subscriptions")
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    <CreditCard className="h-4 w-4" />
                    Subscriptions
                  </Link>
                </li>
              </>
            )}
            {bottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Subscription info */}
        {(profile?.subscription || (profile?.contact_limit ?? 0) > 0) && (
          <div className="shrink-0 border-t border-slate-800 px-3 py-3">
            <div className="rounded-lg bg-slate-800/50 px-3 py-2 space-y-2">
              {profile?.subscription && (
                <>
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium text-white">{profile.subscription.name}</span>
                  </div>
                  {Array.isArray(profile.subscription.features) && profile.subscription.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {profile.subscription.features.map((f, i) => {
                        const iconMap: Record<string, typeof Check> = {
                          Broadcasts: Radio,
                          Automations: Zap,
                          Flows: Workflow,
                        };
                        const Icon = iconMap[f] ?? Check;
                        return (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                          >
                            <Icon className="h-2.5 w-2.5" />
                            {f}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Users className="h-3 w-3" />
                {displayContactCount.toLocaleString()}
                {(profile?.contact_limit ?? 0) > 0 && (
                  <> / {profile!.contact_limit.toLocaleString()} contacts</>
                )}
                {!profile?.contact_limit && <> contacts</>}
              </div>
              {(profile?.contact_limit ?? 0) > 0 && (
                <div className="h-1.5 w-full rounded-full bg-slate-700">
                  <div
                    className={`h-1.5 rounded-full ${
                      displayContactCount >= profile!.contact_limit * 0.8
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                    style={{
                      width: `${Math.min(Math.round((displayContactCount / profile!.contact_limit) * 100), 100)}%`,
                    }}
                  />
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <MessageSquare className="h-3 w-3" />
                {displayMessageCount.toLocaleString()}
                {(profile?.message_limit ?? 0) > 0 && (
                  <> / {profile!.message_limit.toLocaleString()} messages</>
                )}
                {!profile?.message_limit && <> messages</>}
              </div>
              {(profile?.message_limit ?? 0) > 0 && (
                <div className="h-1.5 w-full rounded-full bg-slate-700">
                  <div
                    className={`h-1.5 rounded-full ${
                      displayMessageCount >= profile!.message_limit * 0.8
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                    style={{
                      width: `${Math.min(Math.round((displayMessageCount / profile!.message_limit) * 100), 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Expiry warning */}
        {profile?.subscription_ends_at && (() => {
          const now = new Date();
          const end = new Date(profile.subscription_ends_at!);
          const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86400000);

          if (daysLeft > 7) return null;

          const expired = daysLeft <= 0;

          return (
            <div className="shrink-0 border-t border-slate-800 px-3 py-2">
              <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                expired
                  ? "bg-red-500/10 text-red-400"
                  : "bg-amber-500/10 text-amber-400"
              }`}>
                {expired ? (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <div>
                  {expired
                    ? "Subscription expired"
                    : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
                  }
                </div>
              </div>
            </div>
          );
        })()}

        {/* User section */}
        <div className="shrink-0 border-t border-slate-800 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-800/60 focus:bg-slate-800/60 focus:outline-none data-popup-open:bg-slate-800/60">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-slate-900 text-slate-100 ring-slate-700"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-slate-200 focus:bg-slate-800 focus:text-white"
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-slate-200 focus:bg-slate-800 focus:text-white"
                  />
                }
              >
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-slate-200 focus:bg-slate-800 focus:text-white"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
