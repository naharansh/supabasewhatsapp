"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ShieldCheck, Loader2, Check, X, Clock, ArrowRight } from "lucide-react";

interface UserItem {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  status: string;
  subscription_id: string | null;
  subscription_ends_at: string | null;
}

interface SubscriptionOption {
  id: string;
  name: string;
  price: number;
  duration_days: number;
}

export default function AdminUsersPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<Record<string, string>>({});

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        if (res.status === 403) {
          toast.error("Only superadmins can manage users");
        }
        return;
      }
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/subscriptions-all");
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data.subscriptions ?? []);
      }
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchUsers(), fetchSubscriptions()]);
  }, [fetchUsers, fetchSubscriptions]);

  const handleAction = async (userId: string, status: "active" | "rejected") => {
    setActionLoading(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, status }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to update user");
        return;
      }

      toast.success(status === "active" ? "User approved" : "User rejected");
      fetchUsers();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAssignSubscription = async (userId: string, subscriptionId: string | null) => {
    setAssigningId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, subscription_id: subscriptionId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to assign subscription");
        return;
      }

      const result = await res.json().catch(() => null);

      if (subscriptionId && result?.planName) {
        toast.success(
          `"${result.planName}" assigned — ${result.planDurationDays}d, ${result.planContactLimit === 0 ? "unlimited" : result.planContactLimit + " contacts"}, ${result.planMessageLimit === 0 ? "unlimited" : result.planMessageLimit + " messages"}`,
          { duration: 5000 }
        );
      } else {
        toast.success(subscriptionId ? "Subscription assigned" : "Subscription removed");
      }
      fetchUsers();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setAssigningId(null);
    }
  };

  if (profile?.role !== "superadmin") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        <Card className="bg-slate-900/40 border-slate-800">
          <CardContent className="py-12 text-center">
            <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-slate-600" />
            <p className="text-slate-400">Only superadmins can access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pendingUsers = users.filter((u) => u.status === "pending");
  const otherUsers = users.filter((u) => u.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        <p className="mt-1 text-sm text-slate-400">
          Approve or reject new user registrations, and assign subscriptions.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {pendingUsers.length > 0 && (
            <Card className="bg-slate-900/40 border-slate-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-400">
                  <Clock className="h-5 w-5" />
                  Pending approval ({pendingUsers.length})
                </CardTitle>
                <CardDescription className="text-slate-400">
                  These users have registered and are waiting for approval.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white truncate">
                        {u.fullName || "Unnamed"}
                      </p>
                      <p className="text-sm text-slate-400 truncate">{u.email}</p>
                    </div>
                    <div className="flex gap-2 ml-4 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleAction(u.id, "active")}
                        disabled={actionLoading === u.id}
                      >
                        {actionLoading === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleAction(u.id, "rejected")}
                        disabled={actionLoading === u.id}
                      >
                        {actionLoading === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {pendingUsers.length === 0 && (
            <Card className="bg-slate-900/40 border-slate-800">
              <CardContent className="py-8 text-center">
                <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                <p className="text-slate-400">No pending approvals.</p>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">
                All users ({users.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {otherUsers.map((u) => {
                  const assignedSub = subscriptions.find((s) => s.id === u.subscription_id);
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 px-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">
                          {u.fullName || "Unnamed"}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-3 ml-4 shrink-0">
                        {assigningId === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : (
                          <div className="flex items-center gap-1">
                            <select
                              value={pendingPlan[u.id] ?? u.subscription_id ?? ""}
                              onChange={(e) =>
                                setPendingPlan((prev) => ({ ...prev, [u.id]: e.target.value }))
                              }
                              className="max-w-36 truncate rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 focus:border-primary focus:outline-none"
                            >
                              <option value="">No plan</option>
                              {subscriptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} (₹{s.price}/{s.duration_days}d)
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                const planId = pendingPlan[u.id] ?? u.subscription_id ?? "";
                                handleAssignSubscription(u.id, planId || null);
                                setPendingPlan((prev) => { const next = { ...prev }; delete next[u.id]; return next; });
                              }}
                              className="rounded border border-slate-700 bg-slate-800 p-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
                              title="Apply plan"
                            >
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        <span className={`text-xs font-medium ${u.role === "superadmin" ? "text-amber-400" : "text-slate-500"}`}>
                          {u.role}
                        </span>
                        <span className={`text-xs font-medium ${u.status === "active" ? "text-green-400" : u.status === "rejected" ? "text-red-400" : "text-amber-400"}`}>
                          {u.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
