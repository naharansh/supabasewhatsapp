"use server"

import { createAdminClient } from '@/lib/supabase/admin'
import { auth } from '@/auth'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

async function getCurrentUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  return session.user.id
}

export async function loadMetrics(): Promise<MetricsBundle> {
  const userId = await getCurrentUserId()
  const admin = createAdminClient()
  const todayStart = startOfLocalDay()
  const yesterdayStart = daysAgoStart(1)

  const { data: userConvs } = await admin.from('conversations').select('id').eq('user_id', userId)
  const convIds = userConvs?.map((c) => c.id) ?? []
  const convIn = convIds.length > 0 ? convIds : ['none']

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDealsRes,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    admin.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open'),
    admin.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open').gte('created_at', todayStart.toISOString()),
    admin.from('conversations').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open').gte('created_at', yesterdayStart.toISOString()).lt('created_at', todayStart.toISOString()),
    admin.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', todayStart.toISOString()),
    admin.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', yesterdayStart.toISOString()).lt('created_at', todayStart.toISOString()),
    admin.from('deals').select('value, status').eq('user_id', userId).eq('status', 'open'),
    admin.from('messages').select('*', { count: 'exact', head: true }).eq('sender_type', 'agent').in('conversation_id', convIn).gte('created_at', todayStart.toISOString()),
    admin.from('messages').select('*', { count: 'exact', head: true }).eq('sender_type', 'agent').in('conversation_id', convIn).gte('created_at', yesterdayStart.toISOString()).lt('created_at', todayStart.toISOString()),
  ])

  const openDeals = openDealsRes.data ?? []
  const openDealsValue = openDeals.reduce((sum, d) => sum + Number(d.value), 0)

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
    openDealsValue,
    openDealsCount: openDeals.length,
    messagesSentToday: {
      current: messagesToday.count ?? 0,
      previous: messagesYesterday.count ?? 0,
    },
  }
}

export async function loadConversationsSeries(
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const userId = await getCurrentUserId()
  const admin = createAdminClient()
  const start = daysAgoStart(rangeDays - 1)

  const { data: convs } = await admin.from('conversations').select('id').eq('user_id', userId)
  const convIds = convs?.map((c) => c.id) ?? []

  const { data } = await admin.from('messages')
    .select('created_at, sender_type')
    .in('conversation_id', convIds.length > 0 ? convIds : ['none'])
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: true })

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? [])) {
    const key = localDayKey(new Date(row.created_at).toISOString())
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

export async function loadPipelineDonut(): Promise<PipelineDonutData> {
  const userId = await getCurrentUserId()
  const admin = createAdminClient()

  const { data: pipelines } = await admin.from('pipelines').select('id').eq('user_id', userId)
  const pipelineIds = pipelines?.map((p) => p.id) ?? []
  const pipelineIn = pipelineIds.length > 0 ? pipelineIds : ['none']

  const [stagesRes, dealsRes] = await Promise.all([
    admin.from('pipeline_stages').select('id, name, color, pipeline_id, position')
      .in('pipeline_id', pipelineIn)
      .order('position', { ascending: true }),
    admin.from('deals').select('stage_id, value').eq('user_id', userId).eq('status', 'open'),
  ])

  const stages = stagesRes.data ?? []
  const deals = dealsRes.data ?? []

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += Number(d.value)
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

export async function loadResponseTime(): Promise<ResponseTimeSummary> {
  const userId = await getCurrentUserId()
  const admin = createAdminClient()
  const fourteenDaysAgo = daysAgoStart(13)

  const { data: convs } = await admin.from('conversations').select('id').eq('user_id', userId)
  const convIds = convs?.map((c) => c.id) ?? []

  const { data } = await admin.from('messages')
    .select('conversation_id, sender_type, created_at')
    .in('conversation_id', convIds.length > 0 ? convIds : ['none'])
    .gte('created_at', fourteenDaysAgo.toISOString())
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })

  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of (data ?? [])) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

export async function loadActivity(limit = 20): Promise<ActivityItem[]> {
  const userId = await getCurrentUserId()
  const admin = createAdminClient()

  const { data: convs } = await admin.from('conversations').select('id').eq('user_id', userId)
  const convIds = convs?.map((c) => c.id) ?? []
  const convIn = convIds.length > 0 ? convIds : ['none']

  const [msgsRes, contactsRes, dealsRes, broadcastsRes, autoLogsRes] = await Promise.all([
    admin.from('messages').select(`
      id, content_text, sender_type, created_at, conversation_id,
      conversation:conversations!inner(
        contact_id,
        contact:contacts!inner(name, phone)
      )
    `)
      .eq('sender_type', 'customer')
      .in('conversation_id', convIn)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('contacts').select('id, name, phone, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('deals').select(`
      id, title, updated_at,
      stage:pipeline_stages!inner(name)
    `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(10),
    admin.from('broadcasts').select('id, name, status, total_recipients, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    admin.from('automation_logs').select(`
      id, trigger_event, status, created_at,
      automation:automations!inner(name),
      contact:contacts(name, phone)
    `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const msgs = msgsRes.data ?? []
  const contacts = contactsRes.data ?? []
  const deals = dealsRes.data ?? []
  const broadcasts = broadcastsRes.data ?? []
  const autoLogs = autoLogsRes.data ?? []

  const items: ActivityItem[] = []

  for (const m of msgs) {
    const contact = (m.conversation as any)?.contact
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: new Date(m.created_at).toISOString(),
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of contacts) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: new Date(c.created_at).toISOString(),
      href: '/contacts',
    })
  }

  for (const d of deals) {
    const stage = (d.stage as { name?: string } | undefined)
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: new Date(d.updated_at).toISOString(),
      href: '/pipelines',
    })
  }

  for (const b of broadcasts) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: new Date(b.created_at).toISOString(),
      href: '/broadcasts',
    })
  }

  for (const l of autoLogs) {
    const automation = (l.automation as { name?: string } | undefined)
    const contact = (l.contact as { name?: string; phone?: string } | null | undefined)
    const who = contact?.name || contact?.phone || 'a contact'
    const autoName = automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: new Date(l.created_at).toISOString(),
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
