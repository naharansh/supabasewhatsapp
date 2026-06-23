import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_TABLES = [
  'tags', 'custom_fields', 'contacts', 'contact_tags',
  'contact_custom_values', 'broadcasts', 'broadcast_recipients',
  'message_templates', 'whatsapp_config',
]

const TABLES_WITH_USER_ID = [
  'tags', 'custom_fields', 'contacts', 'broadcasts',
  'message_templates', 'whatsapp_config',
]

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const body = await request.json()
    const { action, table } = body

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
        const { select: columns = '*', filters = [], order, limit, single, count } = body
        query = supabase.from(table).select(columns, count ? { count: 'exact', head: true } : undefined)

        if (TABLES_WITH_USER_ID.includes(table)) {
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
          }
        }

        if (order) {
          const { column, ascending = true } = order
          query = query.order(column, { ascending })
        }

        if (limit) query = query.limit(limit)

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
        for (const f of filters) {
          if (f.operator === 'eq') {
            query = query.eq(f.column, f.value)
          }
        }
        const { data, error } = await query
        if (error) throw error
        return NextResponse.json({ data })
      }

      case 'delete': {
        const { filters = [] } = body
        query = supabase.from(table).delete()
        for (const f of filters) {
          if (f.operator === 'eq') {
            query = query.eq(f.column, f.value)
          }
        }
        const { data, error } = await query
        if (error) throw error
        return NextResponse.json({ data })
      }

      default:
        return NextResponse.json({ error: `Unknown action: '${action}'` }, { status: 400 })
    }
  } catch (error) {
    console.error('Data API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
