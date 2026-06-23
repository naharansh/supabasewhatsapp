import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const supabase = createAdminClient();

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    const { data: targetMessage } = await supabase
      .from('messages')
      .select('id, message_id, conversation_id')
      .eq('id', message_id)
      .single();

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.message_id) {
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('*, contact:contacts(phone)')
      .eq('id', targetMessage.conversation_id)
      .single();

    if (!conversation || conversation.user_id !== userId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const contact = conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token);
    } catch (err) {
      console.error('[react] Token decryption failed:', err);
      return NextResponse.json(
        {
          error:
            'WhatsApp configuration is corrupted — the stored access token cannot be decrypted. ' +
            'Go to Settings → WhatsApp Integration, click "Reset Configuration", then re-save.',
          needs_reset: true,
        },
        { status: 400 },
      );
    }
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);

    try {
      await sendReactionMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: sanitizedPhone,
        targetMessageId: targetMessage.message_id,
        emoji,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[whatsapp/react] Meta send failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }

    if (emoji === '') {
      await supabase
        .from('message_reactions')
        .delete()
        .match({
          message_id: targetMessage.id,
          actor_type: 'agent',
          actor_id: userId,
        });
    } else {
      const { error: reactionError } = await supabase
        .from('message_reactions')
        .upsert(
          {
            message_id: targetMessage.id,
            conversation_id: targetMessage.conversation_id,
            actor_type: 'agent',
            actor_id: userId,
            emoji,
          },
          { onConflict: 'message_id,actor_type,actor_id' }
        );
      if (reactionError) {
        console.error('[react] reaction upsert failed:', reactionError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 },
    );
  }
}
