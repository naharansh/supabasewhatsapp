"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ShieldCheck,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  CreditCard,
  Radio,
  Zap,
  Workflow,
} from "lucide-react";
import type { Subscription } from "@/types";

const SIDEBAR_MENUS = [
  { label: "Broadcasts", icon: Radio },
  { label: "Automations", icon: Zap },
  { label: "Flows", icon: Workflow },
];

export default function AdminSubscriptionsPage() {
  const { profile } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    duration_days: "30",
    features: [] as string[],
    contact_limit: "0",
    message_limit: "0",
    is_active: true,
  });

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/subscriptions");
      if (!res.ok) {
        if (res.status === 403) {
          toast.error("Only superadmins can manage subscriptions");
        }
        return;
      }
      const data = await res.json();
      setSubscriptions(data.subscriptions ?? []);
    } catch {
      toast.error("Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const resetForm = () => {
    setForm({ name: "", description: "", price: "", duration_days: "30", features: [], contact_limit: "0", message_limit: "0", is_active: true });
    setEditingId(null);
    setShowForm(false);
  };

  const openEdit = (sub: Subscription) => {
    setForm({
      name: sub.name,
      description: sub.description ?? "",
      price: String(sub.price),
      duration_days: String(sub.duration_days),
      features: Array.isArray(sub.features) ? [...sub.features] : [],
      contact_limit: String(sub.contact_limit ?? 0),
      message_limit: String(sub.message_limit ?? 0),
      is_active: sub.is_active,
    });
    setEditingId(sub.id);
    setShowForm(true);
  };

  const toggleFeature = (feature: string) => {
    setForm((prev) => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter((f) => f !== feature)
        : [...prev.features, feature],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setActionLoading("save");
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: parseFloat(form.price) || 0,
        duration_days: parseInt(form.duration_days) || 30,
        features: form.features,
        contact_limit: parseInt(form.contact_limit) || 0,
        message_limit: parseInt(form.message_limit) || 0,
        is_active: form.is_active,
      };

      const url = "/api/admin/subscriptions";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...body } : body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to save subscription");
        return;
      }

      toast.success(editingId ? "Subscription updated" : "Subscription created");
      resetForm();
      fetchSubscriptions();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this subscription?")) return;

    setActionLoading(id);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Failed to delete subscription");
        return;
      }

      toast.success("Subscription deleted");
      fetchSubscriptions();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setActionLoading(null);
    }
  };

  if (profile?.role !== "superadmin") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Subscriptions</h1>
        <Card className="bg-slate-900/40 border-slate-800">
          <CardContent className="py-12 text-center">
            <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-slate-600" />
            <p className="text-slate-400">Only superadmins can access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(price);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Subscriptions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage subscription plans for your users.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add subscription
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="bg-slate-900/40 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">
              {editingId ? "Edit subscription" : "New subscription"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Name *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Pro Plan"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Price (INR)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="e.g. 29.99"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Duration (days)</label>
                <Input
                  type="number"
                  min="1"
                  value={form.duration_days}
                  onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
                  placeholder="e.g. 30"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Contact limit (0 = unlimited)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.contact_limit}
                  onChange={(e) => setForm({ ...form, contact_limit: e.target.value })}
                  placeholder="e.g. 5000"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Message limit (0 = unlimited)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.message_limit}
                  onChange={(e) => setForm({ ...form, message_limit: e.target.value })}
                  placeholder="e.g. 50000"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Description</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of this plan..."
                className="bg-slate-800 border-slate-700 text-white"
                rows={2}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-300">
                Sidebar menu access ({form.features.length} selected)
              </label>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {SIDEBAR_MENUS.map((menu) => {
                  const checked = form.features.includes(menu.label);
                  const Icon = menu.icon;
                  return (
                    <label
                      key={menu.label}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? "border-primary/40 bg-primary/10 text-white"
                          : "border-slate-700/50 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFeature(menu.label)}
                        className="rounded border-slate-600 bg-slate-800 text-primary focus:ring-primary"
                      />
                      <Icon className="h-4 w-4" />
                      {menu.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={actionLoading === "save"}>
                {actionLoading === "save" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : editingId ? (
                  <Check className="mr-1 h-4 w-4" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                {editingId ? "Update" : "Create"}
              </Button>
              <Button variant="ghost" onClick={resetForm}>
                <X className="mr-1 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : subscriptions.length === 0 ? (
        <Card className="bg-slate-900/40 border-slate-800">
          <CardContent className="py-12 text-center">
            <CreditCard className="mx-auto mb-4 h-12 w-12 text-slate-600" />
            <p className="text-slate-400">No subscriptions yet.</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setShowForm(true)}
            >
              <Plus className="mr-1 h-4 w-4" />
              Create your first subscription
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map((sub) => (
            <Card
              key={sub.id}
              className="bg-slate-900/40 border-slate-800"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-white">{sub.name}</CardTitle>
                    {sub.description && (
                      <CardDescription className="mt-1 text-slate-400">
                        {sub.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(sub)}
                      disabled={actionLoading === sub.id}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(sub.id)}
                      disabled={actionLoading === sub.id}
                      className="text-red-400 hover:text-red-300"
                    >
                      {actionLoading === sub.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-white">
                    {formatPrice(sub.price)}
                  </span>
                  <span className="text-sm text-slate-400">
                    / {sub.duration_days} days
                  </span>
                </div>

                <div className="text-sm text-slate-400">
                  Contacts:{" "}
                  <span className="text-slate-300 font-medium">
                    {sub.contact_limit > 0 ? sub.contact_limit.toLocaleString() : "Unlimited"}
                  </span>
                </div>
                <div className="text-sm text-slate-400">
                  Messages:{" "}
                  <span className="text-slate-300 font-medium">
                    {sub.message_limit > 0 ? sub.message_limit.toLocaleString() : "Unlimited"}
                  </span>
                </div>

                {Array.isArray(sub.features) && sub.features.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-slate-500">Sidebar access:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {SIDEBAR_MENUS.filter((m) => sub.features.includes(m.label)).map((m) => {
                        const Icon = m.icon;
                        return (
                          <span
                            key={m.label}
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                          >
                            <Icon className="h-3 w-3" />
                            {m.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      sub.is_active
                        ? "bg-green-500/10 text-green-400"
                        : "bg-slate-700/50 text-slate-500"
                    }`}
                  >
                    {sub.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
