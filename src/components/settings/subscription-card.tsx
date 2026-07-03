"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, CreditCard, Loader2, Radio, Zap, Workflow, Users, MessageSquare } from "lucide-react";

const MENU_ICONS: Record<string, typeof Radio> = {
  Broadcasts: Radio,
  Automations: Zap,
  Flows: Workflow,
};

export function SubscriptionCard() {
  const { profile, profileLoading } = useAuth();
  const [counts, setCounts] = useState<{ contact: number; message: number } | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/counts');
      if (res.ok) setCounts(await res.json());
    } catch { /* silent */ }
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

  useEffect(() => {
    if (profile?.contact_count != null || profile?.message_count != null) {
      setCounts(prev => ({
        contact: profile?.contact_count ?? prev?.contact ?? 0,
        message: profile?.message_count ?? prev?.message ?? 0,
      }));
    }
  }, [profile?.contact_count, profile?.message_count]);

  if (profileLoading) {
    return (
      <Card className="bg-slate-900/40 border-slate-800">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  const sub = profile?.subscription;
  const endsAt = profile?.subscription_ends_at;
  const contactLimit = profile?.contact_limit ?? 0;
  const messageLimit = profile?.message_limit ?? 0;
  const contactCount = counts?.contact ?? profile?.contact_count ?? 0;
  const messageCount = counts?.message ?? profile?.message_count ?? 0;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(price);
  };

  const isExpired = endsAt ? new Date(endsAt) < new Date() : false;

  const contactUsagePercent = contactLimit > 0
    ? Math.min(Math.round((contactCount / contactLimit) * 100), 100)
    : 0;

  const messageUsagePercent = messageLimit > 0
    ? Math.min(Math.round((messageCount / messageLimit) * 100), 100)
    : 0;

  const isNearContactLimit = contactLimit > 0 && contactCount >= contactLimit * 0.8;
  const isNearMessageLimit = messageLimit > 0 && messageCount >= messageLimit * 0.8;

  if (!sub) {
    return (
      <Card className="bg-slate-900/40 border-slate-800">
        <CardContent className="py-12 text-center">
          <CreditCard className="mx-auto mb-4 h-12 w-12 text-slate-600" />
          <p className="text-slate-400">No active subscription.</p>
          <p className="mt-1 text-sm text-slate-500">
            Contact your administrator to get a plan.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">{sub.name}</CardTitle>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isExpired
                ? "bg-red-500/10 text-red-400"
                : "bg-green-500/10 text-green-400"
            }`}
          >
            {isExpired ? "Expired" : "Active"}
          </span>
        </div>
        {sub.description && (
          <p className="text-sm text-slate-400 mt-1">{sub.description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-white">
            {formatPrice(sub.price)}
          </span>
          <span className="text-sm text-slate-400">
            / {sub.duration_days} days
          </span>
        </div>

        {endsAt && (
          <div className="text-sm text-slate-400">
            {isExpired ? "Expired" : "Valid until"}:{" "}
            <span className="text-slate-300">
              {new Date(endsAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Users className="h-4 w-4" />
              {contactLimit > 0 ? (
                <span>
                  <span className="text-slate-300 font-medium">{contactCount.toLocaleString()}</span>
                  {" / "}
                  <span className="text-slate-300 font-medium">{contactLimit.toLocaleString()}</span> contacts used
                </span>
              ) : (
                <span>
                  <span className="text-slate-300 font-medium">{contactCount.toLocaleString()}</span> contacts
                </span>
              )}
            </div>
            {contactLimit > 0 && (
              <div className="h-2 w-full rounded-full bg-slate-800">
                <div
                  className={`h-2 rounded-full transition-all ${isNearContactLimit ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${contactUsagePercent}%` }}
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <MessageSquare className="h-4 w-4" />
              {messageLimit > 0 ? (
                <span>
                  <span className="text-slate-300 font-medium">{messageCount.toLocaleString()}</span>
                  {" / "}
                  <span className="text-slate-300 font-medium">{messageLimit.toLocaleString()}</span> messages used
                </span>
              ) : (
                <span>
                  <span className="text-slate-300 font-medium">{messageCount.toLocaleString()}</span> messages
                </span>
              )}
            </div>
            {messageLimit > 0 && (
              <div className="h-2 w-full rounded-full bg-slate-800">
                <div
                  className={`h-2 rounded-full transition-all ${isNearMessageLimit ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${messageUsagePercent}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {Array.isArray(sub.features) && sub.features.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <p className="text-sm font-medium text-slate-300">Sidebar menu access:</p>
            <div className="flex flex-wrap gap-1.5">
              {sub.features.map((feature, i) => {
                const Icon = MENU_ICONS[feature];
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    {feature}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
