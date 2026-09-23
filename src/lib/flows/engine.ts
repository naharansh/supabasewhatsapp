import { createAdminClient } from '@/lib/supabase/admin'
import { recordFlowError, normalizeError } from "./logging";
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
  type TextAreaNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

/**
 * WhatsApp's cap for a single text message body. Kept in the engine so
 * `text_area` nodes can split long pasted lists across multiple messages.
 */
export const TEXT_MESSAGE_MAX_CHARS = 4096;

/**
 * Split long text into chunks of at most `maxChars`, preferring to break
 * at newline boundaries so line-oriented lists stay readable. A single
 * line longer than `maxChars` is hard-split. Pure — extracted for tests.
 */
export function splitTextIntoChunks(
  text: string,
  maxChars = TEXT_MESSAGE_MAX_CHARS,
): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const lines = text.split(/\r?\n/);
  let current = "";

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of lines) {
    if (current.length > 0 && current.length + 1 + line.length > maxChars) {
      flush();
    }
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    current = current.length === 0 ? line : `${current}\n${line}`;
  }
  flush();
  return chunks;
}

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
    node_type === "text_area" ||
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
  const { data: rows, error } = await admin.from('flow_runs')
    .select('*')
    .match({ user_id: userId, contact_id: contactId, status: "active" })
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) {
    await recordFlowError({
      userId,
      contactId,
      code: "LOAD_ACTIVE_RUN_FAILED",
      message: "flow_runs.select failed while loading the active run",
      detail: error.message,
      extra: { status: "active" },
    });
  }
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

async function loadFlow(flowId: string, userId?: string): Promise<{
  id: string;
  userId: string;
  entryNodeId: string | null;
  fallbackPolicy: unknown;
  triggerType: string;
} | null> {
  const admin = createAdminClient()
  const { data: flow, error } = await admin.from('flows').select('*').eq('id', flowId).single();
  if (error) {
    if (userId) {
      await recordFlowError({
        userId,
        flowId,
        code: "LOAD_FLOW_FAILED",
        message: "flows.select failed",
        detail: error.message,
      });
    } else {
      console.error("[flows] LOAD_FLOW_FAILED", { flowId, detail: error.message });
    }
  }
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
  userId?: string,
): Promise<Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('flow_nodes').select('*').eq('flow_id', flowId);
  if (error) {
    if (userId) {
      await recordFlowError({
        userId,
        flowId,
        code: "LOAD_NODES_FAILED",
        message: "flow_nodes.select failed",
        detail: error.message,
      });
    } else {
      console.error("[flows] LOAD_NODES_FAILED", { flowId, detail: error.message });
    }
  }
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
  const { data: flows, error } = await admin.from('flows')
    .select('*')
    .match({ user_id: userId, status: "active" })
    .order('created_at', { ascending: true });
  if (error) {
    await recordFlowError({
      userId,
      code: "FIND_ENTRY_FLOW_FAILED",
      message: "flows.select failed while finding a trigger match",
      detail: error.message,
      extra: { is_first_inbound: isFirstInbound, trigger_type: "keyword/first_inbound" },
    });
  }
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
      await recordFlowError({
        runId: run.id,
        userId: run.user_id,
        contactId: run.contact_id,
        conversationId: run.conversation_id,
        nodeKey: null,
        code: "MISSING_NEXT_NODE",
        message: "next_node_key was null mid-advance",
      });
      await endRun(run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: { node_key: string; node_type: string; config: Record<string, unknown> } | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await recordFlowError({
        runId: run.id,
        userId: run.user_id,
        contactId: run.contact_id,
        conversationId: run.conversation_id,
        nodeKey: currentKey,
        code: "NODE_NOT_FOUND",
        message: `node not found in flow_nodes: ${currentKey}`,
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
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "SEND_MESSAGE_FAILED",
          message: "engineSendText failed",
          detail,
          extra: { cause: message },
        });
        await endRun(run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "text_area") {
      const cfg = node.config as unknown as TextAreaNodeConfig;
      const chunks = splitTextIntoChunks(interpolateVars(cfg.text, run.vars));
      try {
        for (let i = 0; i < chunks.length; i += 1) {
          const { whatsapp_message_id } = await engineSendText({
            userId: run.user_id,
            conversationId: run.conversation_id,
            contactId: run.contact_id,
            text: chunks[i],
          });
          await logEvent(run.id, "message_sent", node.node_key, {
            node_type: "text_area",
            whatsapp_message_id,
            chunk: i + 1,
            total_chunks: chunks.length,
          });
        }
      } catch (err) {
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "TEXT_AREA_SEND_FAILED",
          message: "engineSendText failed for text_area node",
          detail,
          extra: { cause: message, total_chunks: chunks.length },
        });
        await endRun(run.id, "failed", "text_area_send_failed");
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
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "COLLECT_INPUT_PROMPT_FAILED",
          message: "collect_input prompt send failed",
          detail,
          extra: { cause: message },
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
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "LOST_RACE_DURING_ADVANCE",
          message: "advanceCurrentNodeKey matched no active row",
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
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "CONDITION_EVALUATION_FAILED",
          message: "condition evaluation failed",
          detail,
          extra: { cause: message },
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
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "SET_TAG_FAILED",
          message: "set_tag upsert/delete failed",
          detail,
          extra: { cause: message, mode: cfg.mode, tag_id: cfg.tag_id },
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      try {
        await sendButtonsAndSuspend(run, node);
      } catch (err) {
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "SEND_BUTTONS_FAILED",
          message: "send_buttons node failed",
          detail,
          extra: { cause: message },
        });
        await endRun(run.id, "failed", "send_buttons_failed");
        return { outcome: "advanced" };
      }
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "LOST_RACE_DURING_ADVANCE",
          message: "advanceCurrentNodeKey matched no active row",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      try {
        await sendListAndSuspend(run, node);
      } catch (err) {
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "SEND_LIST_FAILED",
          message: "send_list node failed",
          detail,
          extra: { cause: message },
        });
        await endRun(run.id, "failed", "send_list_failed");
        return { outcome: "advanced" };
      }
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "LOST_RACE_DURING_ADVANCE",
          message: "advanceCurrentNodeKey matched no active row",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      try {
        await executeHandoff(
          { id: run.id, conversationId: run.conversation_id },
          node,
        );
      } catch (err) {
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.user_id,
          contactId: run.contact_id,
          conversationId: run.conversation_id,
          nodeKey: node.node_key,
          code: "HANDOFF_FAILED",
          message: "handoff node failed",
          detail,
          extra: { cause: message },
        });
        await endRun(run.id, "failed", "handoff_error");
      }
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(run.id, "completed", node.node_key);
      await endRun(run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    await recordFlowError({
      runId: run.id,
      userId: run.user_id,
      contactId: run.contact_id,
      conversationId: run.conversation_id,
      nodeKey: node.node_key,
      code: "UNKNOWN_NODE_TYPE",
      message: `unknown node_type: ${node.node_type}`,
    });
    await endRun(run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  await recordFlowError({
    runId: run.id,
    userId: run.user_id,
    contactId: run.contact_id,
    conversationId: run.conversation_id,
    nodeKey: currentKey,
    code: "ADVANCE_LOOP_OVERFLOW",
    message: "advance loop hit safety break after 64 iterations",
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
      const nodes = await loadAllNodes(activeRun.flowId, input.userId);
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
    const nodes = await loadAllNodes(flow.id, input.userId);
    return startNewRun(flow, input, nodes);
  } catch (err) {
    const { message, detail } = normalizeError(err);
    await recordFlowError({
      userId: input.userId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      metaMessageId: input.message.meta_message_id,
      code: "ENGINE_THREW",
      message,
      detail,
    });
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      message,
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
    await recordFlowError({
      runId: run.id,
      userId: run.userId,
      contactId: run.contactId,
      conversationId: run.conversationId,
      code: "ACTIVE_RUN_MISSING_NEXT_NODE",
      message: "active run has no current_node_key",
    });
    await endRun(run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.currentNodeKey) ?? null;
  if (!currentNode) {
    await recordFlowError({
      runId: run.id,
      userId: run.userId,
      contactId: run.contactId,
      conversationId: run.conversationId,
      nodeKey: run.currentNodeKey,
      code: "CURRENT_NODE_NOT_FOUND",
      message: `current node not found in flow_nodes: ${run.currentNodeKey}`,
    });
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
      } catch (err) {
        // Supabase threw — the capture failed; fall through to fallback.
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.userId,
          contactId: run.contactId,
          conversationId: run.conversationId,
          nodeKey: currentNode.node_key,
          code: "COLLECT_INPUT_CAPTURE_FAILED",
          message: "could not persist captured var",
          detail,
          extra: { cause: message, var_key: cfg.var_key },
        });
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
  const flowRecord = await loadFlow(run.flowId, run.userId);
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
    try {
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
        await engineSendText({
          userId: run.userId,
          conversationId: run.conversationId!,
          contactId: run.contactId!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      }
    } catch (err) {
      const { message, detail } = normalizeError(err);
      await recordFlowError({
        runId: run.id,
        userId: run.userId,
        contactId: run.contactId,
        conversationId: run.conversationId,
        nodeKey: currentNode.node_key,
        code: "REPROMPT_SEND_FAILED",
        message: "reprompt re-send failed",
        detail,
        extra: { cause: message },
      });
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversationId) {
      try {
        await admin.from('conversations').update({
          status: "pending",
        }).eq('id', run.conversationId);
      } catch (err) {
        const { message, detail } = normalizeError(err);
        await recordFlowError({
          runId: run.id,
          userId: run.userId,
          contactId: run.contactId,
          conversationId: run.conversationId,
          nodeKey: run.currentNodeKey,
          code: "HANDOFF_FAILED",
          message: "conversations.update(status=pending) failed",
          detail,
          extra: { cause: message, reason: "fallback_exhausted" },
        });
      }
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
    const { message, detail } = normalizeError(err as unknown);
    await recordFlowError({
      userId: flow.userId,
      flowId: flow.id,
      contactId: input.contactId,
      conversationId: input.conversationId,
      metaMessageId: input.message.meta_message_id,
      code: "START_RUN_INSERT_FAILED",
      message,
      detail,
    });
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
    const { message, detail } = normalizeError(incErr);
    await recordFlowError({
      userId: flow.userId,
      flowId: flow.id,
      code: "INCREMENT_EXECUTION_COUNT_FAILED",
      message: "increment_flow_execution_count rpc failed",
      detail: message,
      extra: { stack: detail },
    });
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
