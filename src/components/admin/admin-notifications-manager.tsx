"use client";

import { useState } from "react";
import { Megaphone, Send, Loader2, Bell, CheckCircle2, Trophy, Gift, Ticket, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

interface AdminNotificationItem {
  id: string;
  userId: string | null;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string | Date;
  user?: {
    name: string | null;
    email: string | null;
  } | null;
}

interface Props {
  initialNotifications: AdminNotificationItem[];
  totalRecipients: number;
}

export function AdminNotificationsManager({ initialNotifications, totalRecipients }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<"ALL_USERS" | "RECYCLERS_ONLY">("ALL_USERS");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error("Please fill in both title and message");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/admin/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          target,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to broadcast");

      toast.success(data.message || "Broadcast notification sent successfully!");
      setTitle("");
      setMessage("");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to broadcast");
    } finally {
      setSending(false);
    }
  };

  const filtered = initialNotifications.filter((n) => {
    const q = search.toLowerCase();
    return (
      !search ||
      n.title.toLowerCase().includes(q) ||
      n.message.toLowerCase().includes(q) ||
      n.user?.email?.toLowerCase().includes(q) ||
      n.user?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Broadcast Form Card */}
      <div className="rounded-xl border bg-card p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Megaphone className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Broadcast Announcement / Notification</h2>
            <p className="text-xs text-muted-foreground">
              Send an instant notification directly to user inbox boxes (approx. {totalRecipients} active accounts).
            </p>
          </div>
        </div>

        <form onSubmit={handleSendBroadcast} className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="broadcastTitle" className="text-xs">
                Notification Title
              </Label>
              <Input
                id="broadcastTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Monthly Leaderboard Rewards Distributed!"
                className="text-sm"
                required
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="broadcastTarget" className="text-xs">
                Audience Target
              </Label>
              <select
                id="broadcastTarget"
                value={target}
                onChange={(e) => setTarget(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ALL_USERS">All Active Users</option>
                <option value="RECYCLERS_ONLY">Users With Deposits</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="broadcastMessage" className="text-xs">
              Notification Message
            </Label>
            <textarea
              id="broadcastMessage"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Top 3 recyclers for this month have been awarded their points! Check your inbox and points wallet."
              className="w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              required
              maxLength={500}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={sending}
              size="sm"
              className="gap-1.5 bg-primary font-semibold"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {sending ? "Sending..." : "Send Broadcast to All Users"}
            </Button>
          </div>
        </form>
      </div>

      {/* Sent Notifications History */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Recent System & User Notifications</h2>
            <p className="text-xs text-muted-foreground">
              History of leaderboard rewards, vouchers, and direct notices dispatched to users.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter notices..."
              className="pl-8 text-xs h-8"
            />
          </div>
        </div>

        <div className="rounded-xl border overflow-x-auto bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Recipient</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Title</TableHead>
                <TableHead className="text-xs">Message</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                    No notifications recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {format(new Date(n.createdAt), "MMM d, yyyy · h:mm a")}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {n.user ? n.user.email ?? n.user.name : "All Users (Broadcast)"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {n.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-medium max-w-[200px] truncate">
                      {n.title}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">
                      {n.message}
                    </TableCell>
                    <TableCell>
                      {n.isRead ? (
                        <span className="text-[11px] text-muted-foreground">Read</span>
                      ) : (
                        <span className="text-[11px] font-semibold text-primary">Unread</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
