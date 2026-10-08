"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Bell,
  Trophy,
  Gift,
  Ticket,
  CheckCheck,
  Sparkles,
  Info,
  ArrowRight,
  ExternalLink,
  Loader2,
  Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: "DEPOSIT_ACCEPTED" | "DEPOSIT_REJECTED" | "VOUCHER_ISSUED" | "SYSTEM" | "ADMIN_BROADCAST";
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/user/notifications?limit=6");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Ignore background fetch errors
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Poll every 25 seconds for new notifications
    const interval = setInterval(fetchNotifications, 25000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      fetchNotifications();
    }
  };

  const handleMarkAllAsRead = async () => {
    setMarkingAll(true);
    try {
      // Optimistic update
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);

      await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      fetchNotifications();
    } finally {
      setMarkingAll(false);
    }
  };

  const getNotificationIcon = (notif: NotificationItem) => {
    const titleLower = notif.title.toLowerCase();
    const msgLower = notif.message.toLowerCase();

    if (titleLower.includes("leaderboard") || titleLower.includes("rank") || titleLower.includes("🏆")) {
      return (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Trophy className="size-4" />
        </div>
      );
    }
    if (titleLower.includes("free points") || titleLower.includes("bonus") || msgLower.includes("free points")) {
      return (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Gift className="size-4" />
        </div>
      );
    }
    if (notif.type === "VOUCHER_ISSUED" || titleLower.includes("voucher")) {
      return (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
          <Ticket className="size-4" />
        </div>
      );
    }
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Info className="size-4" />
      </div>
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        aria-label="Notifications"
        className="relative flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-all hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <Bell className="size-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-5 h-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white shadow-xs animate-in zoom-in-50 duration-200">
            {unreadCount > 9 ? "9+" : unreadCount}
            <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-[340px] sm:w-[390px] rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl z-50 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications & Inbox</span>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-primary/15 text-primary">
                  {unreadCount} new
                </Badge>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                disabled={markingAll}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {markingAll ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CheckCheck className="size-3.5" />
                )}
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/60">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-2">
                <div className="rounded-full bg-muted p-3 text-muted-foreground">
                  <Bell className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">No notifications yet</p>
                <p className="text-xs text-muted-foreground max-w-[220px]">
                  When you win leaderboard awards or receive admin bonuses, you will see them here.
                </p>
              </div>
            ) : (
              notifications.map((notif) => {
                const isLeaderboard =
                  notif.title.toLowerCase().includes("leaderboard") ||
                  notif.title.toLowerCase().includes("rank") ||
                  notif.title.includes("🏆");

                return (
                  <div
                    key={notif.id}
                    onClick={() => {
                      if (!notif.isRead) handleMarkAsRead(notif.id);
                    }}
                    className={`group relative flex items-start gap-3 p-3.5 transition-colors cursor-pointer hover:bg-muted/50 ${
                      !notif.isRead
                        ? "bg-primary/5 dark:bg-primary/10"
                        : "opacity-85 hover:opacity-100"
                    }`}
                  >
                    {/* Icon */}
                    {getNotificationIcon(notif)}

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <p className="text-xs font-semibold text-foreground leading-tight truncate">
                          {notif.title}
                        </p>
                        {!notif.isRead && (
                          <span className="size-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>

                      <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3">
                        {notif.message}
                      </p>

                      {/* Origin / Auto-credited Badge */}
                      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5 border border-emerald-500/20">
                          <Check className="size-2.5" />
                          Auto-credited to wallet
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer link to full inbox */}
          <div className="border-t border-border/80 p-2.5 bg-muted/20 text-center">
            <Link
              href="/dashboard/notifications"
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:underline w-full py-1"
            >
              <span>View Full Notification Inbox</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
