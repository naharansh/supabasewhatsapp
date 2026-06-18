import { createAdminClient } from '@/lib/supabase/admin'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendText,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "condition" ||
    node_type === "set_tag"
  );
}

export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input"
  );
}

export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  subjectValue: string | undefined;
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O
// ============================================================

async function loadActiveRunForContact(
  userId: string,
  contactId: string,
): Promise<{
  id: string;
  flowId: string;
  userId: string;
  contactId: string | null;
  conversationId: string | null;
  status: string;
  currentNodeKey: string | null;
  lastPromptMessageId: string | null;
  vars: Record<string, unknown>;
  repromptCount: number;
  startedAt: Date;
  lastAdvancedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
} | null> {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('flow_runs')
    .select('*')
    .match({ user_id: userId, contact_id: contactId, status: "active" })
    .order('started_at', { ascending: false })
    .limit(1)
  if (!rows || !rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    flowId: r.flow_id,
    userId: r.user_id,
    contactId: r.contact_id,
    conversationId: r.conversation_id,
    status: r.status,
    currentNodeKey: r.current_node_key,
    lastPromptMessageId: r.last_prompt_message_id,
    vars: r.vars as Record<string, unknown>,
    repromptCount: r.reprompt_count,
    startedAt: new Date(r.started_at),
    lastAdvancedAt: new Date(r.last_advanced_at),
    endedAt: r.ended_at ? new Date(r.ended_at) : null,
    endReason: r.end_reason,
  };
}

async function loadFlow(flowId: string): Promise<{
  id: string;
  userId: string;
  entryNodeId: string | null;
  fallbackPolicy: unknown;
  triggerType: string;
} | null> {
  const admin = createAdminClient()
  const { data: flow } = await admin.from('flows').select('*').eq('id', flowId).single();
  if (!flow) return null;
  return {
    id: flow.id,
    userId: flow.user_id,
    entryNodeId: flow.entry_node_id,
    fallbackPolicy: flow.fallback_policy,
    triggerType: flow.trigger_type,
  };
}

async function loadAllNodes(
  flowId: string,
): Promise<Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>> {
  const admin = createAdminClient()
  const { data } = await admin.from('flow_nodes').select('*').eq('flow_id', flowId);
  const map = new Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>();
  for (const row of (data ?? [])) {
    map.set(row.node_key, {
      node_key: row.node_key,
      node_type: row.node_type,
      config: row.config as Record<string, unknown>,
    });
  }
  return map;
}

async function logEvent(
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('flow_run_events').insert({
      flow_run_id: flowRunId,
      event_type: event_type,
      node_key: node_key,
      payload: payload as any,
    });
  } catch (err) {
    console.error("[flows] logEvent error:", err instanceof Error ? err.message : err);
  }
}

async function isDuplicateInbound(
  userId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data: runs } = await admin.from('flow_runs')
    .select('id')
    .match({ user_id: userId, contact_id: contactId });
  if (!runs || !runs.length) return false;
  const runIds = runs.map((r) => r.id);

  const { data: events } = await admin.from('flow_run_events')
    .select('payload')
    .in('flow_run_id', runIds)
    .eq('event_type', "reply_received");
  const count = (events ?? []).filter((e) => {
    const p = e.payload as Record<string, unknown>;
    return p?.meta_message_id === metaMessageId;
  }).length;
  return count > 0;
}

async function findEntryFlow(
  userId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<{
  id: string;
  userId: string;
  entryNodeId: string | null;
  triggerType: string;
  triggerConfig: unknown;
} | null> {
  if (message.kind !== "text") return null;

  const admin = createAdminClient()
  const { data: flows } = await admin.from('flows')
    .select('*')
    .match({ user_id: userId, status: "active" })
    .order('created_at', { ascending: true });
  if (!flows || !flows.length) return null;

  for (const flow of flows) {
    if (flow.trigger_type === "keyword") {
      if (matchesKeywordTrigger(
        message.text,
        flow.trigger_config as unknown as KeywordTriggerConfig,
      )) {
        return {
          id: flow.id,
          userId: flow.user_id,
          entryNodeId: flow.entry_node_id,
          triggerType: flow.trigger_type,
          triggerConfig: flow.trigger_config,
        };
      }
    } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound) {
      return {
        id: flow.id,
        userId: flow.user_id,
        entryNodeId: flow.entry_node_id,
        triggerType: flow.trigger_type,
        triggerConfig: flow.trigger_config,
      };
    }
  }
  return null;
}

// ============================================================
// Node executors
// ============================================================

async function sendButtonsAndSuspend(
  run: { id: string; user_id: string; conversation_id: string; contact_id: string },
  node: { node_key: string; config: Record<string, unknown> },
): Promise<{ outcome: "advanced"; node_key: string }> {
  const admin = createAdminClient()
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    userId: run.user_id,
    conversationId: run.conversation_id,
    contactId: run.contact_id,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  const { data: msg } = await admin.from('messages')
    .select('id')
    .eq('message_id', whatsapp_message_id)
    .maybeSingle();
  await admin.from('flow_runs').update({
    last_prompt_message_id: msg?.id ?? null,
  }).eq('id', run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  run: { id: string; user_id: string; conversation_id: string; contact_id: string },
  node: { node_key: string; config: Record<string, unknown> },
): Promise<{ outcome: "advanced"; node_key: string }> {
  const admin = createAdminClient()
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    userId: run.user_id,
    conversationId: run.conversation_id,
    contactId: run.contact_id,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const { data: msg } = await admin.from('messages')
    .select('id')
    .eq('message_id', whatsapp_message_id)
    .maybeSingle();
  await admin.from('flow_runs').update({
    last_prompt_message_id: msg?.id ?? null,
  }).eq('id', run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  run: { id: string; conversationId: string | null },
  node: { node_key: string; config: Record<string, unknown> },
): Promise<void> {
  const admin = createAdminClient()
  const cfg = node.config as { assign_to?: string; note?: string };
  const convData: Record<string, unknown> = {
    status: "pending",
  };
  if (cfg.assign_to) convData.assigned_agent_id = cfg.assign_to;
  if (run.conversationId) {
    await admin.from('conversations').update(convData).eq('id', run.conversationId);
  }
  await logEvent(run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(run.id, "handed_off", "handoff_node");
}

async function evaluateConditionNode(
  run: { vars: Record<string, unknown>; contactId: string | null },
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  const admin = createAdminClient()
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await admin.from('contact_tags')
      .select('*', { count: 'exact', head: true })
      .match({ contact_id: run.contactId!, tag_id: cfg.subject_key });
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data: contact } = await admin.from('contacts')
      .select(cfg.subject_key)
      .eq('id', run.contactId!)
      .single();
    const raw = (contact as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function endRun(
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  const admin = createAdminClient()
  await admin.from('flow_runs').update({
    status,
    ended_at: new Date().toISOString(),
    end_reason: reason,
  }).eq('id', runId);
}

// ============================================================
// The synchronous advance loop
// ============================================================

async function advanceFromNodeKey(
  run: {
    id: string;
    user_id: string;
    conversation_id: string;
    contact_id: string;
    current_node_key: string | null;
    vars: Record<string, unknown>;
  },
  startNodeKey: string,
  nodes: Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: { node_key: string; node_type: string; config: Record<string, unknown> } | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          userId: run.user_id,
          conversationId: run.conversation_id,
          contactId: run.contact_id,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          userId: run.user_id,
          conversationId: run.conversation_id,
          contactId: run.contact_id,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const admin = createAdminClient()
        const { data: msg } = await admin.from('messages')
          .select('id')
          .eq('message_id', whatsapp_message_id)
          .maybeSingle();
        await admin.from('flow_runs').update({
          last_prompt_message_id: msg?.id ?? null,
        }).eq('id', run.id);
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(
          { vars: run.vars, contactId: run.contact_id },
          cfg,
        ))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      const admin = createAdminClient()
      try {
        if (cfg.mode === "add") {
          await admin.from('contact_tags').upsert({
            contact_id: run.contact_id!,
            tag_id: cfg.tag_id,
          }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: false }).select().single();
        } else {
          await admin.from('contact_tags').delete().match({
            contact_id: run.contact_id!,
            tag_id: cfg.tag_id,
          });
        }
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      await sendButtonsAndSuspend(run, node);
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      await sendListAndSuspend(run, node);
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      await executeHandoff(
        { id: run.id, conversationId: run.conversation_id },
        node,
      );
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(run.id, "completed", node.node_key);
      await endRun(run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    await logEvent(run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  await logEvent(run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

async function advanceCurrentNodeKey(
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data: updated } = await admin.from('flow_runs')
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .match({
      id: runId,
      status: "active",
      ...(expectedOldKey === null
        ? { current_node_key: null }
        : { current_node_key: expectedOldKey }),
    })
    .select();
  if (!updated || updated.length === 0) {
    console.error("[flows] advanceCurrentNodeKey: no rows matched (lost race)");
    return false;
  }
  return true;
}

// ============================================================
// Public entry point
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  try {
    const activeRun = await loadActiveRunForContact(
      input.userId,
      input.contactId,
    );

    if (activeRun) {
      const dupe = await isDuplicateInbound(
        input.userId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      const nodes = await loadAllNodes(activeRun.flowId);
      return handleReplyForActiveRun(activeRun, input.message, nodes);
    }

    const flow = await findEntryFlow(
      input.userId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entryNodeId) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(flow.id);
    return startNewRun(flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  run: {
    id: string;
    flowId: string;
    userId: string;
    contactId: string | null;
    conversationId: string | null;
    status: string;
    currentNodeKey: string | null;
    lastPromptMessageId: string | null;
    vars: Record<string, unknown>;
    repromptCount: number;
  },
  message: ParsedInbound,
  nodes: Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>,
): Promise<DispatchInboundResult> {
  await logEvent(run.id, "reply_received", run.currentNodeKey, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.currentNodeKey) {
    await endRun(run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.currentNodeKey) ?? null;
  if (!currentNode) {
    await endRun(run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0 && cfg.var_key) {
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      try {
        const admin = createAdminClient()
        await admin.from('flow_runs').update({
          vars: newVars as any,
          reprompt_count: 0,
        }).eq('id', run.id);
        run.vars = newVars;
        run.repromptCount = 0;
        await logEvent(run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      } catch {
        // Supabase threw — the capture failed; fall through to fallback.
      }
    }
  }

  if (matched) {
    if (run.repromptCount !== 0) {
      try {
        const admin = createAdminClient()
        await admin.from('flow_runs').update({
          reprompt_count: 0,
        }).eq('id', run.id);
        run.repromptCount = 0;
      } catch {
        // Non-fatal — continue with the in-memory value.
      }
    }
    const outcome = await advanceFromNodeKey(
      {
        id: run.id,
        user_id: run.userId,
        conversation_id: run.conversationId!,
        contact_id: run.contactId!,
        current_node_key: run.currentNodeKey,
        vars: run.vars,
      },
      matched,
      nodes,
    );
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const flowRecord = await loadFlow(run.flowId);
  const policy = resolveFallbackPolicy(
    flowRecord?.fallbackPolicy as
      | { on_unknown_reply?: string; max_reprompts?: number; on_timeout_hours?: number; on_exhaust?: string }
      | undefined,
  );
  const newReprompts = run.repromptCount + 1;
  const admin = createAdminClient()
  await admin.from('flow_runs').update({
    reprompt_count: newReprompts,
  }).eq('id', run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(run.id, "fallback_fired", run.currentNodeKey, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(
        { id: run.id, user_id: run.userId, conversation_id: run.conversationId!, contact_id: run.contactId! },
        currentNode,
      );
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(
        { id: run.id, user_id: run.userId, conversation_id: run.conversationId!, contact_id: run.contactId! },
        currentNode,
      );
    } else if (currentNode.node_type === "collect_input") {
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          userId: run.userId,
          conversationId: run.conversationId!,
          contactId: run.contactId!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversationId) {
      await admin.from('conversations').update({
        status: "pending",
      }).eq('id', run.conversationId);
    }
    await logEvent(run.id, "handoff", run.currentNodeKey, {
      reason: "fallback_exhausted",
    });
    await endRun(run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  flow: {
    id: string;
    userId: string;
    entryNodeId: string | null;
    triggerType: string;
  },
  input: DispatchInboundInput,
  nodes: Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>,
): Promise<DispatchInboundResult> {
  const admin = createAdminClient()
  let run;
  try {
    const { data, error } = await admin.from('flow_runs').insert({
      flow_id: flow.id,
      user_id: flow.userId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: "active",
      current_node_key: flow.entryNodeId,
    }).select().single();
    if (error) throw error;
    run = data;
  } catch (err: any) {
    // 23505 = unique constraint violation → another webhook is starting the run.
    if (err?.code === '23505') {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", err instanceof Error ? err.message : err);
    return { consumed: false, outcome: "no_match" };
  }

  await logEvent(run.id, "started", flow.entryNodeId, {
    flow_id: flow.id,
    trigger_type: flow.triggerType,
    meta_message_id: input.message.meta_message_id,
  });

  try {
    await admin.rpc('increment_flow_execution_count', { p_flow_id: flow.id });
  } catch (incErr) {
    console.error("[flows] execution_count increment error:", incErr instanceof Error ? incErr.message : incErr);
  }

  const outcome = await advanceFromNodeKey(
    {
      id: run.id,
      user_id: run.user_id,
      conversation_id: run.conversation_id!,
      contact_id: run.contact_id!,
      current_node_key: run.current_node_key,
      vars: run.vars as Record<string, unknown>,
    },
    flow.entryNodeId!,
    nodes,
  );
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
