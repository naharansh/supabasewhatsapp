import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars — check .env.local');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function getUserId(email) {
  // Try profiles first (fastest, no auth API needed)
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (profile) return profile.user_id;

  // Fallback: auth admin API (may not be available depending on key permissions)
  const { data: authData } = await admin.auth.admin.listUsers().catch(() => ({ data: null }));
  const found = authData?.users?.find(x => x.email === email);
  return found?.id ?? null;
}

async function ensureUser(email, password, fullName, role) {
  let uid = await getUserId(email);
  if (uid) {
    console.log(`  User ${email} exists (${uid.slice(0, 8)})`);
    await admin.from('profiles').upsert(
      { user_id: uid, full_name: fullName, email, role },
      { onConflict: 'user_id', ignoreDuplicates: false },
    );
    return uid;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role, status: 'active' },
  });
  if (error) {
    if (String(error.message ?? error).includes('already')) {
      uid = (await admin.auth.admin.listUsers().catch(() => ({ data: null })))
        ?.data?.users?.find(x => x.email === email)?.id;
      if (uid) {
        console.log(`  User ${email} exists (${uid.slice(0, 8)})`);
        await admin.from('profiles').upsert(
          { user_id: uid, full_name: fullName, email, role },
          { onConflict: 'user_id', ignoreDuplicates: false },
        );
        return uid;
      }
    }
    console.error(`  Failed to create ${email}:`, error.message);
    process.exit(1);
  }
  uid = data.user.id;
  await admin.from('profiles').upsert(
    { user_id: uid, full_name: fullName, email, role },
    { onConflict: 'user_id', ignoreDuplicates: false },
  );
  console.log(`  Created ${email} (${uid.slice(0, 8)})`);
  return uid;
}

async function ensureContact(userId, name, phone, extra = {}) {
  const { data: existing } = await admin
    .from('contacts')
    .select('id')
    .eq('phone', phone)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from('contacts')
    .insert({ user_id: userId, name, phone, ...extra })
    .select()
    .single();
  if (error) {
    console.error(`  Failed to create contact ${name}:`, error.message);
    return null;
  }
  return data.id;
}

async function ensureConversation(userId, contactId, status, lastMessageText, lastMessageAt, unreadCount = 0) {
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin
    .from('conversations')
    .insert({
      user_id: userId,
      contact_id: contactId,
      status,
      last_message_text: lastMessageText,
      last_message_at: lastMessageAt,
      unread_count: unreadCount,
    })
    .select()
    .single();
  if (error) {
    console.error(`  Failed to create conversation:`, error.message);
    return null;
  }
  return data.id;
}

async function addMessage(conversationId, senderType, senderId, contentType, contentText, status, createdAt, extra = {}) {
  const { data, error } = await admin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      sender_id: senderId,
      content_type: contentType,
      content_text: contentText,
      status,
      created_at: createdAt,
      ...extra,
    })
    .select()
    .single();
  if (error) {
    console.error(`  Failed to insert message:`, error.message);
    return null;
  }
  return data.id;
}

function ago(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function main() {
  console.log('Seeding inbox test data...\n');

  // 1. Ensure superadmin exists
  console.log('1. Users');
  const uid = await ensureUser('superadmin@gmail.com', '123456', 'Super Admin', 'superadmin');
  if (!uid) process.exit(1);

  // 2. Create contacts with varied names
  console.log('\n2. Contacts');
  const contacts = [
    { name: 'Alice Johnson', phone: '+1-555-0101', email: 'alice@example.com', company: 'Acme Corp' },
    { name: 'Bob Smith', phone: '+1-555-0102', email: 'bob@example.com', company: "Bob's Shop" },
    { name: 'Carol Williams', phone: '+1-555-0103', email: 'carol@example.com', company: 'Design Co' },
    { name: 'David Brown', phone: '+1-555-0104', email: 'david@example.com' },
    { name: 'Eve Davis', phone: '+1-555-0105', email: 'eve@example.com' },
    { name: 'Frank Miller', phone: '+1-555-0106', email: 'frank@example.com' },
  ];
  const contactIds = {};
  for (const c of contacts) {
    const id = await ensureContact(uid, c.name, c.phone, { email: c.email ?? null, company: c.company ?? null });
    if (id) contactIds[c.name] = id;
  }
  console.log(`  ${Object.keys(contactIds).length} contacts ready`);

  // 3. Create conversations
  console.log('\n3. Conversations');
  const convs = [
    {
      contact: 'Alice Johnson', status: 'open', unread: 2,
      text: 'Thanks for the quick response!',
      at: ago(15),
    },
    {
      contact: 'Bob Smith', status: 'open', unread: 0,
      text: 'Sure, I\'ll review the proposal',
      at: ago(120),
    },
    {
      contact: 'Carol Williams', status: 'pending', unread: 0,
      text: 'When can you deliver?',
      at: ago(360),
    },
    {
      contact: 'David Brown', status: 'closed', unread: 0,
      text: 'Perfect, thank you!',
      at: ago(1440),
    },
    {
      contact: 'Eve Davis', status: 'open', unread: 5,
      text: 'Hello? Are you there?',
      at: ago(5),
    },
    {
      contact: 'Frank Miller', status: 'pending', unread: 1,
      text: 'Can you send the catalog?',
      at: ago(60),
    },
  ];
  const convIds = {};
  for (const c of convs) {
    const cid = contactIds[c.contact];
    if (!cid) continue;
    const id = await ensureConversation(uid, cid, c.status, c.text, c.at, c.unread);
    if (id) convIds[c.contact] = id;
  }
  console.log(`  ${Object.keys(convIds).length} conversations ready`);

  // 4. Seed messages for each conversation
  console.log('\n4. Messages');

  // Alice — Open, recent, 2 unread
  const aliceConv = convIds['Alice Johnson'];
  if (aliceConv) {
    await addMessage(aliceConv, 'customer', null, 'text', 'Hi, I wanted to ask about your pricing for the enterprise plan.', 'read', ago(480));
    await addMessage(aliceConv, 'agent', uid, 'text', 'Hi Alice! Our enterprise plan starts at $499/month. Would you like me to send over a detailed brochure?', 'read', ago(470));
    await addMessage(aliceConv, 'customer', null, 'text', 'That sounds reasonable. Does it include priority support?', 'read', ago(120));
    await addMessage(aliceConv, 'agent', uid, 'text', 'Yes, enterprise includes 24/7 priority support with a dedicated account manager.', 'read', ago(115));
    await addMessage(aliceConv, 'customer', null, 'text', 'Great! Can you also tell me about the onboarding process?', 'read', ago(30));
    await addMessage(aliceConv, 'agent', uid, 'text', 'Sure! Onboarding typically takes 2-3 business days. We handle the migration and train your team.', 'sent', ago(20));
    await addMessage(aliceConv, 'customer', null, 'text', 'Thanks for the quick response!', 'sent', ago(15));
    console.log('  Alice Johnson: 7 messages');
  }

  // Bob — Open, no unread, waiting for reply
  const bobConv = convIds['Bob Smith'];
  if (bobConv) {
    await addMessage(bobConv, 'customer', null, 'text', 'Hello, I need help with setting up my account.', 'read', ago(600));
    await addMessage(bobConv, 'agent', uid, 'text', 'Hi Bob! I\'d be happy to help. What seems to be the issue?', 'read', ago(590));
    await addMessage(bobConv, 'customer', null, 'text', 'I can\'t figure out how to import my contacts from the CSV file.', 'read', ago(300));
    await addMessage(bobConv, 'agent', uid, 'text', 'No problem! Go to Settings → Import → Upload CSV. Make sure your CSV has the columns: name, phone, email.', 'read', ago(290));
    await addMessage(bobConv, 'customer', null, 'text', 'Got it, that worked! One more question — can I automate follow-up messages?', 'read', ago(180));
    await addMessage(bobConv, 'agent', uid, 'text', 'Absolutely! You can set up automations in the Automations section. Would you like me to walk you through it?', 'read', ago(170));
    await addMessage(bobConv, 'customer', null, 'text', 'Sure, I\'ll review the proposal', 'read', ago(120));
    console.log('  Bob Smith: 7 messages');
  }

  // Carol — Pending, no unread
  const carolConv = convIds['Carol Williams'];
  if (carolConv) {
    await addMessage(carolConv, 'customer', null, 'text', 'Hi, I saw your ad on social media. Are you accepting new clients?', 'read', ago(4320));
    await addMessage(carolConv, 'agent', uid, 'text', 'Hi Carol! Yes, we\'re accepting new clients. What type of services are you looking for?', 'read', ago(4310));
    await addMessage(carolConv, 'customer', null, 'text', 'We need a complete CRM solution for our sales team of 15 people.', 'read', ago(1440));
    await addMessage(carolConv, 'agent', uid, 'text', 'Perfect! Our platform is designed for teams your size. I can set up a demo for you this week.', 'read', ago(1430));
    await addMessage(carolConv, 'customer', null, 'text', 'That would be great. How about Thursday at 2 PM?', 'read', ago(720));
    await addMessage(carolConv, 'agent', uid, 'text', 'Thursday at 2 PM works perfectly. I\'ll send you a calendar invite.', 'read', ago(710));
    await addMessage(carolConv, 'customer', null, 'text', 'When can you deliver?', 'delivered', ago(360));
    console.log('  Carol Williams: 7 messages');
  }

  // David — Closed (resolved)
  const davidConv = convIds['David Brown'];
  if (davidConv) {
    await addMessage(davidConv, 'customer', null, 'text', 'I need to reset my password.', 'read', ago(2880));
    await addMessage(davidConv, 'agent', uid, 'text', 'Sure! Click on "Forgot Password" on the login page and follow the instructions sent to your email.', 'read', ago(2870));
    await addMessage(davidConv, 'customer', null, 'text', 'Done! Got it reset. Thanks!', 'read', ago(1500));
    await addMessage(davidConv, 'agent', uid, 'text', 'You\'re welcome! Let us know if you need anything else.', 'read', ago(1490));
    await addMessage(davidConv, 'customer', null, 'text', 'Perfect, thank you!', 'read', ago(1440));
    console.log('  David Brown: 5 messages');
  }

  // Eve — Open, 5 unread (customer sent multiple messages waiting for reply)
  const eveConv = convIds['Eve Davis'];
  if (eveConv) {
    await addMessage(eveConv, 'customer', null, 'text', 'I\'m having trouble with the WhatsApp integration.', 'delivered', ago(120));
    await addMessage(eveConv, 'customer', null, 'text', 'It keeps saying "invalid token" even though I just generated a new one.', 'delivered', ago(90));
    await addMessage(eveConv, 'customer', null, 'image', '', 'delivered', ago(60), { media_url: 'https://picsum.photos/seed/error/400/300' });
    await addMessage(eveConv, 'customer', null, 'text', 'Here is a screenshot of the error.', 'delivered', ago(59));
    await addMessage(eveConv, 'customer', null, 'text', 'Hello? Are you there?', 'sent', ago(5));
    console.log('  Eve Davis: 5 messages (unread)');
  }

  // Frank — Pending, 1 unread
  const frankConv = convIds['Frank Miller'];
  if (frankConv) {
    await addMessage(frankConv, 'customer', null, 'text', 'Hi! I heard about your CRM and wanted to learn more.', 'read', ago(600));
    await addMessage(frankConv, 'agent', uid, 'text', 'Hi Frank! We\'d love to tell you more. What features are you most interested in?', 'read', ago(590));
    await addMessage(frankConv, 'customer', null, 'text', 'Mainly contact management and broadcast messaging.', 'read', ago(480));
    await addMessage(frankConv, 'agent', uid, 'text', 'Great choices! Our contact management lets you tag, segment, and track every interaction. Broadcasts support up to 10k messages per campaign.', 'read', ago(470));
    await addMessage(frankConv, 'customer', null, 'text', 'That sounds perfect. Can you send the catalog?', 'sent', ago(60));
    console.log('  Frank Miller: 5 messages');
  }

  // 5. Add a few reactions (skip if message_reactions table doesn't exist)
  console.log('\n5. Reactions');
  try {
    const allMessages = await admin
      .from('messages')
      .select('id, conversation_id, content_text')
      .in('content_text', ['That sounds reasonable. Does it include priority support?', 'Perfect, thank you!', 'Sure, I\'ll review the proposal']);
    
    if (allMessages.data?.length) {
      for (const msg of allMessages.data) {
        const emoji = msg.content_text === 'Perfect, thank you!' ? '👍' : '❤️';
        const { error } = await admin.from('message_reactions').upsert(
          {
            message_id: msg.id,
            conversation_id: msg.conversation_id,
            actor_type: 'customer',
            emoji,
          },
          { onConflict: 'message_id,actor_type,emoji', ignoreDuplicates: true },
        );
        if (error?.message?.includes('schema cache')) break;
      }
      console.log(`  ${allMessages.data.length} reactions added`);
    }
  } catch {
    console.log('  (message_reactions table not available, skipped)');
  }

  console.log('\n✓ Inbox test data seeded!');
  console.log('  Login: superadmin@gmail.com / 123456');
}

main().catch(console.error);
