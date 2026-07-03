import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_TABLES = [
  'tags', 'custom_fields', 'contacts', 'contact_tags',
  'contact_custom_values', 'contact_notes', 'broadcasts',
  'broadcast_recipients', 'message_templates', 'whatsapp_config',
  'deals', 'pipeline_stages', 'pipelines', 'profiles', 'conversations',
  'messages', 'message_reactions', 'automations',
]

const TABLES_WITH_USER_ID = [
  'tags', 'custom_fields', 'contacts', 'contact_notes',
  'broadcasts', 'message_templates', 'whatsapp_config', 'deals',
  'pipelines', 'conversations', 'automations',
]

function isTableNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code: unknown }).code) === 'PGRST205'
  )
}

function emptyResponse(action: string) {
  return NextResponse.json({ data: action === 'select' ? [] : null, count: 0 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, table: string, userId: string, fFilters: any[], fOrFilter?: string): any {
  if (TABLES_WITH_USER_ID.includes(table)) {
    q = q.eq('user_id', userId)
  }
  for (const f of fFilters) {
    const { column, operator, value } = f
    switch (operator) {
      case 'eq': q = q.eq(column, value); break
      case 'neq': q = q.neq(column, value); break
      case 'in': q = q.in(column, value); break
      case 'ilike': q = q.ilike(column, value); break
      case 'gte': q = q.gte(column, value); break
      case 'lte': q = q.lte(column, value); break
    }
  }
  if (fOrFilter) q = q.or(fOrFilter)
  return q
}

export async function POST(request: Request) {
  let action = ''
  let table = ''
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await request.json()
    ;({ action, table } = body as { action: string; table: string })

    if (!action || !table) {
      return NextResponse.json({ error: 'action and table are required' }, { status: 400 })
    }

    if (!ALLOWED_TABLES.includes(table)) {
      return NextResponse.json({ error: `Table '${table}' is not allowed` }, { status: 403 })
    }

    const supabase = createAdminClient()

    if (action === 'select') {
      const { select: columns = '*', filters = [], order, limit, offset, single, count, or: orFilter } = body

      let exactCount: number | undefined
      if (count) {
        let countQuery: any = supabase.from(table).select('id', { count: 'exact', head: true })
        countQuery = applyFilters(countQuery, table, userId, filters, orFilter)
        const { count: exact } = await countQuery
        exactCount = exact ?? undefined
      }

      let query: any = supabase.from(table).select(columns)
      query = applyFilters(query, table, userId, filters, orFilter)

      if (order) {
        const orders = Array.isArray(order) ? order : [order]
        for (const o of orders) {
          const { column, ascending = true } = o
          query = query.order(column, { ascending })
        }
        query = query.order('id', { ascending: false })
      }

      if (limit && offset !== undefined) {
        query = query.range(offset, offset + limit - 1)
      } else {
        if (limit) query = query.limit(limit)
        if (offset !== undefined) query = query.range(offset, offset + 1000000)
      }

      if (single) {
        const { data, error } = await query.maybeSingle()
        if (error) throw error
        return NextResponse.json({ data })
      }

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ data, count: exactCount })
    }

    if (action === 'insert') {
      const { values, select = false } = body
      let query: any = supabase.from(table).insert(values)
      if (select) query = query.select()
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ data })
    }

    if (action === 'update') {
      const { values, filters = [] } = body
      let query: any = supabase.from(table).update(values)

      if (TABLES_WITH_USER_ID.includes(table)) {
        query = query.eq('user_id', userId)
      }

      for (const f of filters) {
        if (f.operator === 'eq') {
          query = query.eq(f.column, f.value)
        }
      }
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ data })
    }

    if (action === 'upsert') {
      const { values, onConflict, select = false } = body
      let query: any = supabase.from(table).upsert(values, onConflict ? { onConflict, ignoreDuplicates: false } : undefined)
      if (select) query = query.select()
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ data })
    }

    if (action === 'delete') {
      const { filters = [] } = body

      if (table === 'broadcasts') {
        const bcFilter = filters.find((f: { column: string }) => f.column === 'id')
        const bcId = bcFilter?.value
        if (bcId && TABLES_WITH_USER_ID.includes(table)) {
          const { error: recErr } = await supabase
            .from('broadcast_recipients')
            .delete()
            .eq('broadcast_id', bcId)
          if (recErr) throw recErr
        }
      }

      let query: any = supabase.from(table).delete()

      if (TABLES_WITH_USER_ID.includes(table)) {
        query = query.eq('user_id', userId)
      }

      for (const f of filters) {
        if (f.operator === 'eq') {
          query = query.eq(f.column, f.value)
        } else if (f.operator === 'in') {
          query = query.in(f.column, f.value)
        }
      }
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ data })
    }

    return NextResponse.json({ error: `Unknown action: '${action}'` }, { status: 400 })
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code ?? '')
        : ''

    // PGRST205 = table not found in schema cache. Not a server error —
    // return empty data so UIs degrade gracefully instead of toasting errors.
    if (code === 'PGRST205') {
      return emptyResponse(action)
    }

    const message = error instanceof Error ? error.message : 'Internal server error'
    const details =
      error && typeof error === 'object' && 'details' in error
        ? String((error as { details: unknown }).details ?? '')
        : ''
    console.error('Data API error:', message, code, details, error)
    return NextResponse.json({ error: code ? `${code}: ${message}` : message }, { status: 500 })
  }
}
