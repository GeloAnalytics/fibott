"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  Trophy,
  Gift,
  Ticket,
  CheckCircle2,
  Sparkles,
  Info,
  CheckCheck,
  Trash2,
  Search,
  Wallet,
  ArrowUpRight,
  Loader2,
  Check,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export interface NotificationItem {
  id: string;
  userId: string | null;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string | Date;
}

interface Props {
  initialNotifications: NotificationItem[];
  initialUnreadCount: number;
}

export function NotificationsManager({ initialNotifications, initialUnreadCount }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [tab, setTab] = useState<"ALL" | "UNREAD" | "LEADERBOARD" | "POINTS_VOUCHERS">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleMarkAsRead = async (id: string) => {
    try {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      const res = await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      toast.error("Failed to update notification");
    }
  };

  const handleMarkAllAsRead = async () => {
    setLoadingAction("mark_all");
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);

      const res = await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("All notifications marked as read");
      router.refresh();
    } catch {
      toast.error("Failed to mark all as read");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      const res = await fetch("/api/user/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      toast.success("Notification removed");
      router.refresh();
    } catch {
      toast.error("Failed to delete notification");
    }
  };

  const handleClearRead = async () => {
    if (!confirm("Remove all read notifications from your inbox?")) return;
    setLoadingAction("clear_read");
    try {
      setNotifications((prev) => prev.filter((n) => !n.isRead));
      const res = await fetch("/api/user/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearRead: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Cleared read notifications");
      router.refresh();
    } catch {
      toast.error("Failed to clear read notifications");
    } finally {
      setLoadingAction(null);
    }
  };

  // Filters
  const filteredNotifications = notifications.filter((notif) => {
    const titleLower = notif.title.toLowerCase();
    const messageLower = notif.message.toLowerCase();
    const queryLower = searchQuery.toLowerCase();

    const matchesSearch =
      !searchQuery ||
      titleLower.includes(queryLower) ||
      messageLower.includes(queryLower);

    if (!matchesSearch) return false;

    if (tab === "UNREAD") return !notif.isRead;
    if (tab === "LEADERBOARD") {
      return (
        titleLower.includes("leaderboard") ||
        titleLower.includes("rank") ||
        titleLower.includes("🏆")
      );
    }
    if (tab === "POINTS_VOUCHERS") {
      return (
        titleLower.includes("point") ||
        titleLower.includes("voucher") ||
        titleLower.includes("bonus") ||
        titleLower.includes("gift") ||
        titleLower.includes("🎁") ||
        notif.type === "VOUCHER_ISSUED"
      );
    }
    return true;
  });

  const getCardIcon = (notif: NotificationItem) => {
    const titleLower = notif.title.toLowerCase();
    const msgLower = notif.message.toLowerCase();

    if (titleLower.includes("leaderboard") || titleLower.includes("rank") || titleLower.includes("🏆")) {
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <Trophy className="size-5" />
        </div>
      );
    }
    if (titleLower.includes("points") || titleLower.includes("bonus") || msgLower.includes("points")) {
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <Gift className="size-5" />
        </div>
      );
    }
    if (notif.type === "VOUCHER_ISSUED" || titleLower.includes("voucher")) {
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          <Ticket className="size-5" />
        </div>
      );
    }
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/20">
        <Info className="size-5" />
      </div>
    );
  };

  const isLeaderboard = (notif: NotificationItem) => {
    const titleLower = notif.title.toLowerCase();
    return titleLower.includes("leaderboard") || titleLower.includes("rank") || titleLower.includes("🏆");
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header and Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Notifications & Inbox</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Track your leaderboard rewards, bonus points, WiFi voucher notices, and system announcements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllAsRead}
              disabled={loadingAction === "mark_all"}
              className="gap-1.5 text-xs h-8"
            >
              {loadingAction === "mark_all" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <CheckCheck className="size-3.5 text-emerald-600" />
              )}
              Mark all read
            </Button>
          )}

          {notifications.some((n) => n.isRead) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearRead}
              disabled={loadingAction === "clear_read"}
              className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-destructive"
            >
              {loadingAction === "clear_read" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Clear read
            </Button>
          )}
        </div>
      </div>

      {/* Informational Rewards Explainer Banner */}
      <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4 sm:p-5 shadow-xs space-y-2">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
          <Sparkles className="size-4.5 shrink-0" />
          <span>Automatic Reward Delivery (No Claim Required)</span>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          When you place in the Top 3 of our monthly recycling leaderboard or receive free points from administrators, your points are <strong>immediately credited to your Points Balance</strong>. This inbox is your official ledger to verify why, when, and where your points originated.
        </p>
        <div className="flex items-center gap-3 pt-1 text-xs">
          <Link
            href="/dashboard/wallet"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <Wallet className="size-3.5" />
            <span>Open Points Wallet</span>
            <ArrowUpRight className="size-3" />
          </Link>
          <span className="text-border">|</span>
          <Link
            href="/dashboard/leaderboard"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <Trophy className="size-3.5" />
            <span>View Leaderboard</span>
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setTab("ALL")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === "ALL"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("UNREAD")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              tab === "UNREAD"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Unread
            {unreadCount > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] text-white">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("LEADERBOARD")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1 ${
              tab === "LEADERBOARD"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            🏆 Leaderboard
          </button>
          <button
            type="button"
            onClick={() => setTab("POINTS_VOUCHERS")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1 ${
              tab === "POINTS_VOUCHERS"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            🎁 Points & Vouchers
          </button>
        </div>

        <div className="relative w-full sm:w-60">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notifications..."
            className="pl-8 text-xs h-8.5 rounded-lg"
          />
        </div>
      </div>

      {/* Notifications Cards List */}
      <div className="space-y-3">
        {filteredNotifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center space-y-3">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">No notifications found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {searchQuery
                  ? "No notifications match your search query."
                  : tab === "UNREAD"
                  ? "You have read all your notifications."
                  : "Notifications for leaderboard awards, bonus points, and vouchers will appear here."}
              </p>
            </div>
          </div>
        ) : (
          filteredNotifications.map((notif) => {
            const dateObj = new Date(notif.createdAt);
            const isWinner = isLeaderboard(notif);

            return (
              <div
                key={notif.id}
                className={`group relative rounded-2xl border p-4 sm:p-5 transition-all shadow-xs space-y-3 ${
                  !notif.isRead
                    ? "border-primary/40 bg-card ring-1 ring-primary/20 shadow-md"
                    : "border-border/80 bg-card/60 hover:bg-card"
                }`}
              >
                {/* Top Row: Icon, Title, Type, Actions */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {getCardIcon(notif)}

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm sm:text-base font-bold text-foreground">
                          {notif.title}
                        </h2>
                        {!notif.isRead && (
                          <Badge variant="default" className="text-[10px] px-2 py-0.5 font-bold h-4.5 bg-primary">
                            NEW
                          </Badge>
                        )}
                        {isWinner && (
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold gap-1">
                            <Trophy className="size-2.5" /> Top Recycler Award
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <span>{format(dateObj, "MMM d, yyyy · h:mm a")}</span>
                        <span>•</span>
                        <span>{formatDistanceToNow(dateObj, { addSuffix: true })}</span>
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!notif.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkAsRead(notif.id)}
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                        title="Mark as read"
                      >
                        <Check className="size-4 text-primary" />
                        <span className="hidden sm:inline ml-1">Mark read</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(notif.id)}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Message Body */}
                <div className="rounded-xl bg-muted/40 p-3.5 text-xs sm:text-sm text-foreground/90 leading-relaxed border border-border/50">
                  {notif.message}
                </div>

                {/* Status Footer Badge */}
                <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="size-3.5" />
                      Status: Credited to Points Balance (No Action Needed)
                    </span>
                  </div>

                  <Link
                    href="/dashboard/wallet"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline ml-auto"
                  >
                    <span>Check Wallet Balance</span>
                    <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
