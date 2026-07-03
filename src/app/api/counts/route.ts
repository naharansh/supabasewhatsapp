import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const admin = createAdminClient();

  const { count: contactCount } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { data: convIds } = await admin
    .from('conversations')
    .select('id')
    .eq('user_id', userId);

  const ids = convIds?.map(c => c.id) ?? [];

  const agentQueryOrFallback = ids.length > 0
    ? admin.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_type', 'agent')
        .in('conversation_id', ids)
    : Promise.resolve({ count: 0, error: null });

  const { data: userBroadcasts } = await admin
    .from('broadcasts')
    .select('id')
    .eq('user_id', userId);

  const broadcastIds = userBroadcasts?.map(b => b.id) ?? [];
  const broadcastQueryOrFallback = broadcastIds.length > 0
    ? admin.from('broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .in('broadcast_id', broadcastIds)
        .in('status', ['sent', 'delivered', 'read'])
    : Promise.resolve({ count: 0, error: null });

  const [agentResult, broadcastResult] = await Promise.all([agentQueryOrFallback, broadcastQueryOrFallback]);

  return NextResponse.json({
    contact_count: contactCount ?? 0,
    message_count: (agentResult.count ?? 0) + (broadcastResult.count ?? 0),
  });
}
