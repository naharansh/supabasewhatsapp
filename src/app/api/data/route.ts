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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any

    switch (action) {
      case 'select': {
        const { select: columns = '*', filters = [], order, limit, offset, single, count, head, or: orFilter, skipUserFilter } = body
        query = supabase.from(table).select(columns, count ? { count: 'exact', head: !!head } : undefined)

        if (TABLES_WITH_USER_ID.includes(table) && !skipUserFilter) {
          query = query.eq('user_id', userId)
        }

        for (const f of filters) {
          const { column, operator, value } = f
          switch (operator) {
            case 'eq':
              query = query.eq(column, value)
              break
            case 'neq':
              query = query.neq(column, value)
              break
            case 'in':
              query = query.in(column, value)
              break
            case 'ilike':
              query = query.ilike(column, value)
              break
            case 'gte':
              query = query.gte(column, value)
              break
            case 'lte':
              query = query.lte(column, value)
              break
          }
        }

        if (orFilter) {
          query = query.or(orFilter)
        }

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

        if (count) {
          const { data, count: total, error } = await query
          if (error) throw error
          return NextResponse.json({ data, count: total })
        }

        const { data, error } = await query
        if (error) throw error
        return NextResponse.json({ data })
      }

      case 'insert': {
        const { values, select = false } = body
        query = supabase.from(table).insert(values)
        if (select) query = query.select()
        const { data, error } = await query
        if (error) throw error
        return NextResponse.json({ data })
      }

      case 'update': {
        const { values, filters = [] } = body
        query = supabase.from(table).update(values)

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

      case 'upsert': {
        const { values, onConflict, select = false } = body
        query = supabase.from(table).upsert(values, onConflict ? { onConflict, ignoreDuplicates: false } : undefined)
        if (select) query = query.select()
        const { data, error } = await query
        if (error) throw error
        return NextResponse.json({ data })
      }

      case 'delete': {
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



        query = supabase.from(table).delete()

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

      case 'select_tag_contacts': {
        const { tagIds = [], excludeTagIds = [] } = body
        if (!Array.isArray(tagIds) || tagIds.length === 0) {
          return NextResponse.json({ data: [], count: 0 })
        }

        // Supabase PostgREST caps at 1000 rows by default, so paginate
        // all contact_tags queries to fetch the full result set.
        const CT_PAGE = 1000

        // Paginated fetch for contact_tags rows
        async function fetchTagContactIds(ids: string[]): Promise<Set<string>> {
          const result = new Set<string>()
          let page = 0
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { data: batch, error } = await supabase
              .from('contact_tags')
              .select('contact_id')
              .in('tag_id', ids)
              .range(page * CT_PAGE, page * CT_PAGE + CT_PAGE - 1)
            if (error) throw error
            if (!batch || batch.length === 0) break
            for (const r of batch) {
              if (r.contact_id) result.add(r.contact_id)
            }
            if (batch.length < CT_PAGE) break
            page++
          }
          return result
        }

        const allIds = await fetchTagContactIds(tagIds)
        if (allIds.size === 0) {
          return NextResponse.json({ data: [], count: 0 })
        }

        // Fetch all user's contact IDs once, then intersect
        const userContactIds = new Set<string>()
        let cPage = 0
        const C_PAGE = 1000
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data: batch } = await supabase
            .from('contacts')
            .select('id')
            .eq('user_id', userId)
            .range(cPage * C_PAGE, cPage * C_PAGE + C_PAGE - 1)
          if (!batch || batch.length === 0) break
          for (const r of batch) userContactIds.add(r.id)
          if (batch.length < C_PAGE) break
          cPage++
        }

        const verifiedIds = [...allIds].filter((id) => userContactIds.has(id))
        let resultSet = new Set(verifiedIds)

        if (Array.isArray(excludeTagIds) && excludeTagIds.length > 0 && resultSet.size > 0) {
          const exIds = await fetchTagContactIds(excludeTagIds)
          resultSet = new Set([...resultSet].filter((id) => !exIds.has(id)))
        }

        return NextResponse.json({ data: [...resultSet], count: resultSet.size })
      }

      default:
        return NextResponse.json({ error: `Unknown action: '${action}'` }, { status: 400 })
    }
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

    // Foreign key violation — show a clear message without leaking PG internals
    if (code === '23503') {
      const details =
        error && typeof error === 'object' && 'details' in error
          ? String((error as { details: unknown }).details ?? '')
          : ''
      const refMatch = details.match(/still referenced from table "(\w+)"/)
      const refTable = refMatch ? refMatch[1] : 'another table'
      console.error('Data API error:', details)
      return NextResponse.json({
        error: `Cannot delete this record because it is still referenced from "${refTable}". Remove or reassign related records first.`,
      }, { status: 409 })
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
