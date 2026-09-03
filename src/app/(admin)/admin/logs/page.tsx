"use client";

import { useEffect, useState, useCallback } from "react";
import { formatLogTime, formatLogTimeDetailed } from "@/lib/date-utils";
import {
  AlertTriangle,
  Cpu,
  RefreshCw,
  Search,
  Server,
  Trash2,
  CheckCircle2,
  Info,
  XCircle,
  Wifi,
  WifiOff,
  Clock,
  Send,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface SystemLogEntry {
  id: string;
  source: "HARDWARE" | "SYSTEM";
  level: "INFO" | "WARN" | "ERROR";
  tag: string;
  message: string;
  details?: string | null;
  createdAt: string;
  device?: {
    id: string;
    name: string;
    location?: string | null;
  } | null;
}

interface LogMetrics {
  totalErrors: number;
  totalWarnings: number;
  hardwareErrors: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface DeviceHealth {
  id: string;
  name: string;
  type: string;
  status: string;
  location?: string | null;
  lastSeenAt?: string | null;
  connectivity: "online" | "stale" | "offline" | "unknown";
  recentErrors: number;
  recentWarnings: number;
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [metrics, setMetrics] = useState<LogMetrics>({
    totalErrors: 0,
    totalWarnings: 0,
    hardwareErrors: 0,
  });
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 30,
    total: 0,
    totalPages: 1,
  });

  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<SystemLogEntry | null>(null);

  // Device health state
  const [devices, setDevices] = useState<DeviceHealth[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);

  // Send Alert form state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertLevel, setAlertLevel] = useState<"INFO" | "WARN" | "ERROR">("WARN");
  const [alertTag, setAlertTag] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [alertDetails, setAlertDetails] = useState("");
  const [alertDeviceId, setAlertDeviceId] = useState("");
  const [alertSending, setAlertSending] = useState(false);

  const fetchLogs = useCallback(
    async (showLoadingState = false) => {
      if (showLoadingState) setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", pagination.page.toString());
        params.set("limit", pagination.limit.toString());
        if (levelFilter !== "ALL") params.set("level", levelFilter);
        if (sourceFilter !== "ALL") params.set("source", sourceFilter);
        if (searchQuery.trim()) params.set("search", searchQuery.trim());

        const res = await fetch(`/api/admin/logs?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load system logs");
        const data = await res.json();

        setLogs(data.logs || []);
        setMetrics(data.metrics || { totalErrors: 0, totalWarnings: 0, hardwareErrors: 0 });
        setPagination(data.pagination || { page: 1, limit: 30, total: 0, totalPages: 1 });
      } catch (err) {
        console.error("Error fetching logs:", err);
      } finally {
        setLoading(false);
      }
    },
    [pagination.page, pagination.limit, levelFilter, sourceFilter, searchQuery]
  );

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const res = await fetch("/api/admin/device-alerts");
      if (!res.ok) throw new Error("Failed to load device health");
      const data = await res.json();
      setDevices(data.devices || []);
    } catch (err) {
      console.error("Error fetching device health:", err);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs(true);
  }, [fetchLogs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDevices();
  }, [fetchDevices]);

  // Auto-refresh interval (5s for logs, 30s for device health)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    const interval = setInterval(fetchDevices, 30000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  async function handlePurgeLogs(all = false) {
    if (!confirm(all ? "Are you sure you want to delete ALL logs?" : "Delete logs older than 7 days?")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/logs?all=${all}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear logs");
      toast.success(all ? "All logs cleared" : "Old logs purged");
      fetchLogs(true);
    } catch {
      toast.error("Could not clear logs");
    }
  }

  async function handleSendAlert(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!alertTag.trim() || !alertMessage.trim()) {
      toast.error("Tag and message are required");
      return;
    }
    setAlertSending(true);
    try {
      const res = await fetch("/api/admin/device-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: alertLevel,
          tag: alertTag.trim().toUpperCase(),
          message: alertMessage.trim(),
          details: alertDetails.trim() || undefined,
          deviceId: alertDeviceId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to send alert");
      toast.success("Alert logged to system");
      setAlertOpen(false);
      setAlertTag("");
      setAlertMessage("");
      setAlertDetails("");
      setAlertDeviceId("");
      setAlertLevel("WARN");
      fetchLogs(true);
    } catch {
      toast.error("Could not send alert");
    } finally {
      setAlertSending(false);
    }
  }

  function getLevelBadge(level: "INFO" | "WARN" | "ERROR") {
    switch (level) {
      case "ERROR":
        return (
          <Badge variant="destructive" className="gap-1 font-mono text-xs">
            <XCircle className="size-3" /> ERROR
          </Badge>
        );
      case "WARN":
        return (
          <Badge className="gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-mono text-xs">
            <AlertTriangle className="size-3" /> WARN
          </Badge>
        );
      case "INFO":
      default:
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-xs">
            <Info className="size-3" /> INFO
          </Badge>
        );
    }
  }

  function getSourceBadge(source: "HARDWARE" | "SYSTEM") {
    if (source === "HARDWARE") {
      return (
        <Badge variant="outline" className="gap-1 border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono text-xs">
          <Cpu className="size-3" /> Kiosk Hardware
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-mono text-xs">
        <Server className="size-3" /> Backend / System
      </Badge>
    );
  }

  function getConnectivityBadge(connectivity: DeviceHealth["connectivity"], lastSeenAt?: string | null) {
    const ago = lastSeenAt ? formatDistanceToNow(new Date(lastSeenAt), { addSuffix: true }) : null;
    switch (connectivity) {
      case "online":
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Online</span>
            </div>
            {ago && <span className="text-[10px] text-muted-foreground">Seen {ago}</span>}
          </div>
        );
      case "stale":
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <Clock className="size-3 text-amber-500" />
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Stale</span>
            </div>
            {ago && <span className="text-[10px] text-muted-foreground">Seen {ago}</span>}
          </div>
        );
      case "offline":
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <WifiOff className="size-3 text-destructive" />
              <span className="text-xs font-semibold text-destructive">Offline</span>
            </div>
            {ago && <span className="text-[10px] text-muted-foreground">Last seen {ago}</span>}
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5">
            <Wifi className="size-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Never seen</span>
          </div>
        );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System &amp; Hardware Logs</h1>
          <p className="text-sm text-muted-foreground">
            Realtime telemetry, hardware errors, and backend diagnostic reports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => setAlertOpen(true)}
            className="gap-2"
          >
            <Send className="size-3.5" />
            Send Alert
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "Live (5s)" : "Paused"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchLogs(true)}>
            Refresh Now
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePurgeLogs(false)} className="text-muted-foreground">
            <Trash2 className="size-3.5 mr-1" /> Purge &gt;7 Days
          </Button>
        </div>
      </div>

      {/* Device Health Panel */}
      <div>
        <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide mb-3">
          Device Health
        </h2>
        {devicesLoading ? (
          <div className="text-sm text-muted-foreground">Loading device health…</div>
        ) : devices.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No devices registered. Register an ESP32-CAM in the device management section.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {devices.map((device) => (
              <Card
                key={device.id}
                className={`border transition-colors ${
                  device.connectivity === "online"
                    ? "border-emerald-500/30"
                    : device.connectivity === "offline"
                    ? "border-destructive/30"
                    : device.connectivity === "stale"
                    ? "border-amber-500/30"
                    : ""
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{device.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{device.type}</p>
                      {device.location && (
                        <p className="text-[11px] text-muted-foreground">{device.location}</p>
                      )}
                    </div>
                    <Badge
                      variant={device.status === "ACTIVE" ? "secondary" : "outline"}
                      className="text-[10px] shrink-0"
                    >
                      {device.status}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between">
                    {getConnectivityBadge(device.connectivity, device.lastSeenAt)}
                    <div className="flex items-center gap-2 text-[10px]">
                      {device.recentErrors > 0 && (
                        <span className="flex items-center gap-0.5 text-destructive font-semibold">
                          <XCircle className="size-3" /> {device.recentErrors}E
                        </span>
                      )}
                      {device.recentWarnings > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-500 font-semibold">
                          <AlertTriangle className="size-3" /> {device.recentWarnings}W
                        </span>
                      )}
                      {device.recentErrors === 0 && device.recentWarnings === 0 && (
                        <span className="text-muted-foreground">No issues (24h)</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Log Entries</CardTitle>
            <Server className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{pagination.total}</div>
            <p className="text-xs text-muted-foreground">Recorded logs in database</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Hardware Errors</CardTitle>
            <Cpu className="size-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-destructive">
              {metrics.hardwareErrors}
            </div>
            <p className="text-xs text-muted-foreground">ESP32-CAM / Kiosk error events</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">System Errors</CardTitle>
            <AlertTriangle className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {metrics.totalErrors}
            </div>
            <p className="text-xs text-muted-foreground">API &amp; Router communication failures</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Monitoring Status</CardTitle>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {autoRefresh ? "Active" : "Paused"}
            </div>
            <p className="text-xs text-muted-foreground">Serial monitor alternative active</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4 space-y-4 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground mr-1">Level:</span>
            {["ALL", "ERROR", "WARN", "INFO"].map((lvl) => (
              <Button
                key={lvl}
                size="sm"
                variant={levelFilter === lvl ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => {
                  setLevelFilter(lvl);
                  setPagination((p) => ({ ...p, page: 1 }));
                }}
              >
                {lvl}
              </Button>
            ))}

            <span className="text-xs font-semibold uppercase text-muted-foreground ml-3 mr-1">Source:</span>
            {["ALL", "HARDWARE", "SYSTEM"].map((src) => (
              <Button
                key={src}
                size="sm"
                variant={sourceFilter === src ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => {
                  setSourceFilter(src);
                  setPagination((p) => ({ ...p, page: 1 }));
                }}
              >
                {src}
              </Button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search tag or message..."
              className="pl-8 h-9 text-xs"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Log Feed Table */}
      <Card>
        <CardContent className="p-0">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No logs found matching the current filters.
            </div>
          ) : (
            <div className="divide-y divide-border overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground font-mono uppercase">
                  <tr>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Level</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Tag</th>
                    <th className="py-3 px-4">Message</th>
                    <th className="py-3 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-mono whitespace-nowrap text-muted-foreground">
                        {formatLogTime(log.createdAt)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">{getLevelBadge(log.level)}</td>
                      <td className="py-3 px-4 whitespace-nowrap">{getSourceBadge(log.source)}</td>
                      <td className="py-3 px-4 font-mono font-semibold text-foreground whitespace-nowrap">
                        [{log.tag}]
                      </td>
                      <td className="py-3 px-4 max-w-md truncate">
                        <span className="font-medium text-foreground">{log.message}</span>
                        {log.device && (
                          <span className="ml-2 text-muted-foreground text-[10px]">
                            ({log.device.name})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {log.details ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs font-mono"
                            onClick={() => setSelectedLog(log)}
                          >
                            View Data
                          </Button>
                        ) : (
                          <span className="text-muted-foreground font-mono text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Footer */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono">
              [{selectedLog?.tag}] Log Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {selectedLog && getLevelBadge(selectedLog.level)}
              {selectedLog && getSourceBadge(selectedLog.source)}
              <span className="font-mono text-muted-foreground">
                {selectedLog && formatLogTimeDetailed(selectedLog.createdAt)}
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Message</p>
              <p className="text-sm font-medium mt-1">{selectedLog?.message}</p>
            </div>

            {selectedLog?.details && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase pb-1">Raw Payload / Stack Trace</p>
                <pre className="p-3 rounded-md bg-muted font-mono text-xs overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {selectedLog.details}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Alert Dialog */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-4" />
              Send Hardware Alert
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Manually flag a hardware issue or observation. This will appear in the log feed and admin dashboard immediately.
          </p>
          <form onSubmit={handleSendAlert} className="space-y-4 pt-2">
            {/* Level selector */}
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">
                Severity Level
              </label>
              <div className="flex gap-2">
                {(["INFO", "WARN", "ERROR"] as const).map((lvl) => (
                  <Button
                    key={lvl}
                    type="button"
                    size="sm"
                    variant={alertLevel === lvl ? "default" : "outline"}
                    className={`text-xs h-8 ${
                      lvl === "ERROR" && alertLevel === "ERROR"
                        ? "bg-destructive hover:bg-destructive/90"
                        : lvl === "WARN" && alertLevel === "WARN"
                        ? "bg-amber-500 hover:bg-amber-500/90 text-white"
                        : ""
                    }`}
                    onClick={() => setAlertLevel(lvl)}
                  >
                    {lvl}
                  </Button>
                ))}
              </div>
            </div>

            {/* Device target (optional) */}
            {devices.length > 0 && (
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">
                  Target Device <span className="font-normal normal-case">(optional)</span>
                </label>
                <select
                  value={alertDeviceId}
                  onChange={(e) => setAlertDeviceId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— No specific device —</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Tag */}
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">
                Tag
              </label>
              <Input
                placeholder="e.g. CAMERA, SERVO, POWER, NETWORK"
                value={alertTag}
                onChange={(e) => setAlertTag(e.target.value.toUpperCase())}
                maxLength={32}
                className="text-sm font-mono"
              />
            </div>

            {/* Message */}
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground mb-1.5 block">
                Message
              </label>
              <Input
                placeholder="Short description of the issue"
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                maxLength={500}
                className="text-sm"
              />
            </div>

            {/* Details (expandable) */}
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5"
                onClick={() => setAlertDetails(alertDetails ? "" : " ")}
              >
                {alertDetails !== "" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                Additional details / observations
              </button>
              {alertDetails !== "" && (
                <textarea
                  placeholder="Paste error codes, observations, troubleshooting steps taken..."
                  value={alertDetails}
                  onChange={(e) => setAlertDetails(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={alertSending} className="gap-2">
                {alertSending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {alertSending ? "Sending…" : "Log Alert"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAlertOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
