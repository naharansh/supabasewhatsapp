"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CircleAlert, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";

/**
 * Flow error log viewer.
 *
 * Lists the most recent `flow_error_logs` rows for a flow, newest
 * first — run-scoped errors AND pre-run failures that never got a run
 * id. Each row shows the stable error code, message, and (expandable)
 * detail. This is where "why did my flow silently stall?" gets its
 * answer without hunting through server logs.
 */

interface FlowErrorRow {
  id: string;
  run_id: string | null;
  contact_id: string | null;
  node_key: string | null;
  error_code: string;
  message: string;
  detail: string | null;
  meta_message_id: string | null;
  created_at: string;
}

export default function FlowErrorsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [errors, setErrors] = useState<FlowErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const errRes = await fetch(`/api/flows/${params.id}/errors`);
        if (errRes.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!errRes.ok) throw new Error(`Failed: ${errRes.status}`);
        const json = (await errRes.json()) as {
          errors?: FlowErrorRow[];
        };
        if (!cancelled) setErrors(json.errors ?? []);
        const flowRes = await fetch(`/api/flows/${params.id}`);
        if (flowRes.ok) {
          const fj = (await flowRes.json()) as { flow?: { id: string; name: string } };
          if (fj.flow && !cancelled) setFlow(fj.flow);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flow error logs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-slate-400">Flow not found.</p>
        <button
          type="button"
          onClick={() => router.push("/flows")}
          className="text-sm text-primary hover:opacity-80"
        >
          ← Back to flows
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button
        type="button"
        onClick={() => router.push(`/flows/${params.id}`)}
        className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
      >
        <ArrowLeft className="h-3 w-3" />
        {flow?.name ?? "Flow"}
      </button>
      <h1 className="text-xl font-semibold text-white">Errors</h1>
      <p className="mt-1 text-sm text-slate-400">
        Recent flow-service failures — run-scoped and pre-run. Errors recorded
        against a run also appear in that run&apos;s event timeline.
      </p>

      {errors.length === 0 ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-900/50 px-6 py-12 text-sm text-slate-400">
          <AlertTriangle className="h-4 w-4 shrink-0 text-emerald-400" />
          No logged errors for this flow.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {errors.map((e) => (
            <ErrorCard
              key={e.id}
              error={e}
              expanded={expanded.has(e.id)}
              onToggle={() => toggle(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorCard({
  error,
  expanded,
  onToggle,
}: {
  error: FlowErrorRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-900/40 bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <CircleAlert className="h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-red-300">
              {error.error_code}
            </code>
            {error.node_key && (
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                {error.node_key}
              </code>
            )}
            {error.run_id && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                has run
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-slate-200">{error.message}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>{format(new Date(error.created_at), "PP p")}</span>
            {error.meta_message_id && (
              <span>· msg {error.meta_message_id.slice(0, 12)}…</span>
            )}
          </div>
        </div>
      </button>
      {expanded && error.detail && (
        <pre className="mx-4 mb-3 mt-0 overflow-x-auto rounded-md border-t border-slate-800 bg-slate-950 p-2 text-[11px] whitespace-pre-wrap text-slate-300">
          {error.detail}
        </pre>
      )}
    </div>
  );
}