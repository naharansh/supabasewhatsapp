'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { BroadcastRecipient, Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerUrl?: string;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveHeaderParams(
  template: MessageTemplate,
  headerUrl?: string,
): import('@/lib/whatsapp/meta-api').TemplateHeaderParam[] | undefined {
  const url = headerUrl || template.header_content;
  if (!url) return undefined;
  switch (template.header_type) {
    case 'image':
      return [{ type: 'image', image: { link: url } }];
    case 'video':
      return [{ type: 'video', video: { link: url } }];
    case 'document':
      return [{ type: 'document', document: { link: url } }];
    default:
      return undefined;
  }
}

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        table: 'contact_custom_values',
        select: 'contact_id, custom_field_id, value',
        filters: [{ column: 'contact_id', operator: 'in', value: slice }],
      }),
    });
    if (!res.ok) continue;
    const json = await res.json();

    for (const row of json.data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function fetchContactsByIds(ids: string[]): Promise<Contact[]> {
    if (ids.length === 0) return [];
    const PAGE = 500;
    const all: Contact[] = [];
    for (let i = 0; i < ids.length; i += PAGE) {
      const chunk = ids.slice(i, i + PAGE);
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'contacts',
          filters: [{ column: 'id', operator: 'in', value: chunk }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Failed to fetch contacts: ${err.error || res.statusText}`);
      }
      const json = await res.json();
      all.push(...(json.data ?? []));
    }
    return all;
  }

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      let page = 0;
      const PAGE = 1000;
      while (true) {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'select',
            table: 'contacts',
            limit: PAGE,
            offset: page * PAGE,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(`Failed to fetch contacts: ${err.error || res.statusText}`);
        }
        const json = await res.json();
        const batch = json.data ?? [];
        contacts.push(...batch);
        if (batch.length < PAGE) break;
        page++;
      }
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const tagRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'contact_tags',
          select: 'contact_id',
          filters: [{ column: 'tag_id', operator: 'in', value: audience.tagIds }],
        }),
      });
      if (!tagRes.ok) {
        const err = await tagRes.json().catch(() => ({}));
        throw new Error(`Failed to fetch contact tags: ${err.error || tagRes.statusText}`);
      }
      const tagJson = await tagRes.json();

      if (tagJson.data && tagJson.data.length > 0) {
        const uniqueContactIds = [
          ...new Set(tagJson.data.map((ct: { contact_id: string }) => ct.contact_id).filter(Boolean) as string[]),
        ];
        contacts = await fetchContactsByIds(uniqueContactIds);
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(audience.csvContacts);
    }

    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const excludeRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'contact_tags',
          select: 'contact_id',
          filters: [{ column: 'tag_id', operator: 'in', value: audience.excludeTagIds }],
        }),
      });
      if (excludeRes.ok) {
        const excludeJson = await excludeRes.json();
        const excludedIds = new Set((excludeJson.data ?? []).map((r: { contact_id: string }) => r.contact_id).filter(Boolean) as string[]);
        contacts = contacts.filter((c) => !excludedIds.has(c.id));
      }
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    if (!user) {
      throw new Error('You are not signed in.');
    }

    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    const lookupRes = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        table: 'contacts',
        filters: [{ column: 'phone', operator: 'in', value: phones }],
      }),
    });
    if (!lookupRes.ok) throw new Error('Failed to look up CSV contacts');
    const lookupJson = await lookupRes.json();

    const byPhone = new Map<string, Contact>();
    for (const c of (lookupJson.data ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const insertRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          table: 'contacts',
          values: chunk,
          select: true,
        }),
      });
      if (!insertRes.ok) throw new Error('Failed to create CSV contacts');
      const insertJson = await insertRes.json();
      for (const c of (insertJson.data ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;
    const op = operator === 'contains' ? 'ilike' : operator === 'is_not' ? 'neq' : 'eq';
    const val = operator === 'contains' ? `%${value}%` : value;

    const matchRes = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        table: 'contact_custom_values',
        select: 'contact_id',
        filters: [
          { column: 'custom_field_id', operator: 'eq', value: fieldId },
          { column: 'value', operator: op, value: val },
        ],
      }),
    });
    if (!matchRes.ok) throw new Error('Custom-field filter failed');
    const matchJson = await matchRes.json();

    const contactIds = [...new Set((matchJson.data ?? []).map((m: { contact_id: string }) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const contactRes = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        table: 'contacts',
        filters: [{ column: 'id', operator: 'in', value: contactIds }],
      }),
    });
    if (!contactRes.ok) throw new Error('Failed to fetch contacts');
    const contactJson = await contactRes.json();
    return contactJson.data ?? [];
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    try {
      if (!user) {
        throw new Error('You are not signed in.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const bcRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'insert',
          table: 'broadcasts',
          values: {
            user_id: user.id,
            name: payload.name,
            template_name: payload.template.name,
            template_language: payload.template.language ?? 'en_US',
            template_variables: payload.variables,
            audience_filter: {
              type: payload.audience.type,
              tagIds: payload.audience.tagIds,
              customField: payload.audience.customField,
              excludeTagIds: payload.audience.excludeTagIds,
            },
            status: 'sending',
            total_recipients: contacts.length,
            sent_count: 0,
            delivered_count: 0,
            read_count: 0,
            replied_count: 0,
            failed_count: 0,
          },
          select: true,
        }),
      });
      if (!bcRes.ok) throw new Error('Failed to create broadcast');
      const bcJson = await bcRes.json();
      const broadcast = bcJson.data?.[0];
      if (!broadcast) throw new Error('Failed to create broadcast');

      // ── Step 3: Insert recipient rows ─────────────────────────────
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const insRes = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'insert',
            table: 'broadcast_recipients',
            values: batch,
          }),
        });
        if (!insRes.ok) {
          await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              table: 'broadcasts',
              values: { status: 'failed', failed_count: contacts.length },
              filters: [{ column: 'id', operator: 'eq', value: broadcast.id }],
            }),
          });
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}`,
          );
        }
      }

      // ── Step 4: Fetch recipients (joined contact) + preload custom values
      setProgress(30);
      const recsRes = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          table: 'broadcast_recipients',
          select: '*, contact:contacts(*)',
          filters: [{ column: 'broadcast_id', operator: 'eq', value: broadcast.id }],
        }),
      });
      if (!recsRes.ok) throw new Error('Failed to fetch broadcast recipients');
      const recsJson = await recsRes.json();
      const recipients = recsJson.data ?? [];

      const contactIds = recipients
        .map((r: BroadcastRecipient) => r.contact?.id)
        .filter((id: string | undefined): id is string => Boolean(id));
      const customValueIndex = await fetchCustomValueIndex(contactIds);

      let failedCount = 0;
      const totalRecipients = recipients.length;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r: BroadcastRecipient) => r.contact?.phone)
          .map((r: BroadcastRecipient) => ({
            phone: r.contact!.phone as string,
            params: r.contact
              ? resolveVariables(
                  payload.variables,
                  r.contact,
                  customValueIndex.get(r.contact.id),
                )
              : {},
          }));

        if (apiRecipients.length === 0) continue;

        try {
          const headerParams = resolveHeaderParams(payload.template, payload.headerUrl);
          const res = await fetch('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: apiRecipients,
              template_name: payload.template.name,
              template_language: payload.template.language ?? 'en_US',
              header_params: headerParams,
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Broadcast API request failed');
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'update',
                  table: 'broadcast_recipients',
                  values: { status: 'failed', error_message: 'No phone number on contact' },
                  filters: [{ column: 'id', operator: 'eq', value: recipient.id }],
                }),
              });
              continue;
            }

            if (result.status === 'sent') {
              // Step 1: Store Meta message_id immediately so the webhook
              // can find this recipient for status updates. Closes the
              // race window between Meta's 200 OK and our status write.
              await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'update',
                  table: 'broadcast_recipients',
                  values: {
                    whatsapp_message_id: result.whatsapp_message_id ?? null,
                  },
                  filters: [{ column: 'id', operator: 'eq', value: recipient.id }],
                }),
              });

              // Step 2: Mark as sent — only if the webhook hasn't
              // already transitioned the status (e.g. to 'failed').
              // If the webhook already moved it, skip to avoid
              // overwriting a terminal state.
              await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'update',
                  table: 'broadcast_recipients',
                  values: {
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    error_message: null,
                  },
                  filters: [
                    { column: 'id', operator: 'eq', value: recipient.id },
                    { column: 'status', operator: 'eq', value: 'pending' },
                  ],
                }),
              });
            } else {
              failedCount++;
              await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'update',
                  table: 'broadcast_recipients',
                  values: { status: 'failed', error_message: result.error ?? 'Unknown error' },
                  filters: [{ column: 'id', operator: 'eq', value: recipient.id }],
                }),
              });
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            await fetch('/api/data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'update',
                table: 'broadcast_recipients',
                values: { status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown error' },
                filters: [{ column: 'id', operator: 'eq', value: recipient.id }],
              }),
            });
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          table: 'broadcasts',
          values: { status: finalStatus },
          filters: [{ column: 'id', operator: 'eq', value: broadcast.id }],
        }),
      });

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
