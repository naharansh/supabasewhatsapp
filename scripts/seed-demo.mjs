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
  const { data: users } = await admin.from('users').select('id').eq('email', email);
  if (users?.length) return users[0].id;
  const { data: authUsers } = await admin.auth.admin.listUsers();
  const u = authUsers?.users?.find(x => x.email === email);
  return u?.id ?? null;
}

async function main() {
  console.log('Seeding demo CRM data...\n');

  const superadminId = await getUserId('superadmin@gmail.com');
  if (!superadminId) {
    console.error('Superadmin not found — run supabase/seed.sql first');
    process.exit(1);
  }
  console.log(`Superadmin ID: ${superadminId}`);

  // ---- Tags ----
  const tags = ['VIP', 'New Lead', 'Hot', 'Follow Up', 'Not Interested', 'Enterprise'];
  const tagIds = {};
  for (const name of tags) {
    const { data: existing } = await admin.from('tags').select('id').eq('name', name).eq('user_id', superadminId).maybeSingle();
    if (existing) {
      tagIds[name] = existing.id;
    } else {
      const { data, error } = await admin.from('tags').insert({ name, user_id: superadminId, color: '#' + Math.floor(Math.random()*16777215).toString(16) }).select().single();
      if (error) { console.error(`Tag insert error: ${error.message}`); continue; }
      tagIds[name] = data.id;
    }
  }
  console.log(`Tags: ${Object.keys(tagIds).join(', ')}`);

  // ---- Pipeline ----
  let pipelineId;
  const { data: existingPipeline } = await admin.from('pipelines').select('id').eq('user_id', superadminId).limit(1).maybeSingle();
  if (existingPipeline) {
    pipelineId = existingPipeline.id;
  } else {
    const { data, error } = await admin.from('pipelines').insert({ name: 'Sales Pipeline', user_id: superadminId }).select().single();
    if (error) { console.error(`Pipeline insert error: ${error.message}`); process.exit(1); }
    pipelineId = data.id;
  }
  console.log(`Pipeline: ${pipelineId}`);

  // ---- Pipeline Stages ----
  const stagesData = [
    { name: 'New Lead', color: '#94a3b8', position: 1 },
    { name: 'Contacted', color: '#3b82f6', position: 2 },
    { name: 'Qualified', color: '#8b5cf6', position: 3 },
    { name: 'Proposal', color: '#f59e0b', position: 4 },
    { name: 'Negotiation', color: '#f97316', position: 5 },
    { name: 'Closed Won', color: '#22c55e', position: 6 },
    { name: 'Closed Lost', color: '#ef4444', position: 7 },
  ];
  let stageIds = {};
  const { data: existingStages } = await admin.from('pipeline_stages').select('id, name').eq('pipeline_id', pipelineId);
  if (existingStages?.length) {
    for (const s of existingStages) stageIds[s.name] = s.id;
  } else {
    for (const s of stagesData) {
      const { data, error } = await admin.from('pipeline_stages').insert({ ...s, pipeline_id: pipelineId }).select().single();
      if (error) { console.error(`Stage insert error: ${error.message}`); continue; }
      stageIds[s.name] = data.id;
    }
  }
  console.log(`Pipeline stages: ${Object.keys(stageIds).join(', ')}`);

  // ---- Contacts ----
  const contactsData = [
    { name: 'Alice Johnson', phone: '+1-555-0101', email: 'alice@example.com', company: 'Acme Corp', tags: ['VIP', 'Enterprise'] },
    { name: 'Bob Smith', phone: '+1-555-0102', email: 'bob@example.com', company: 'Bob\'s Shop', tags: ['New Lead'] },
    { name: 'Carol Williams', phone: '+1-555-0103', email: 'carol@example.com', company: 'Design Co', tags: ['Hot', 'Follow Up'] },
    { name: 'David Brown', phone: '+1-555-0104', email: 'david@example.com', tags: ['Enterprise'] },
    { name: 'Eve Davis', phone: '+1-555-0105', email: 'eve@example.com', tags: ['Not Interested'] },
    { name: 'Frank Miller', phone: '+1-555-0106', email: 'frank@example.com', tags: ['Follow Up'] },
    { name: 'Grace Wilson', phone: '+1-555-0107', email: 'grace@example.com', company: 'Wilson Inc', tags: ['VIP'] },
    { name: 'Henry Taylor', phone: '+1-555-0108', email: 'henry@example.com', tags: ['New Lead'] },
  ];
  const contactIds = [];
  for (const c of contactsData) {
    const { data: existing } = await admin.from('contacts').select('id').eq('phone', c.phone).eq('user_id', superadminId).maybeSingle();
    if (existing) {
      contactIds.push(existing.id);
      continue;
    }
    const { data, error } = await admin.from('contacts').insert({
      name: c.name,
      phone: c.phone,
      email: c.email ?? null,
      company: c.company ?? null,
      user_id: superadminId,
    }).select().single();
    if (error) { console.error(`Contact insert error: ${error.message}`); continue; }
    contactIds.push(data.id);
    for (const tagName of c.tags) {
      if (tagIds[tagName]) {
        await admin.from('contact_tags').upsert({ contact_id: data.id, tag_id: tagIds[tagName] }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
      }
    }
  }
  console.log(`Contacts: ${contactIds.length}`);

  // ---- Deals ----
  const dealData = [
    { title: 'Website Redesign', stage: 'Proposal', value: 15000 },
    { title: 'Mobile App Dev', stage: 'Qualified', value: 45000 },
    { title: 'SEO Package', stage: 'New Lead', value: 5000 },
    { title: 'Cloud Migration', stage: 'Negotiation', value: 30000 },
    { title: 'Brand Design', stage: 'Contacted', value: 12000 },
    { title: 'API Integration', stage: 'Closed Won', value: 25000, status: 'won' },
  ];
  for (let i = 0; i < dealData.length; i++) {
    const d = dealData[i];
    const stageId = stageIds[d.stage];
    if (!stageId) { console.log(`  Skipping deal "${d.title}" — stage "${d.stage}" not found`); continue; }
    const { data: existing } = await admin.from('deals').select('id').eq('title', d.title).eq('user_id', superadminId).maybeSingle();
    if (existing) continue;
    const { error } = await admin.from('deals').insert({
      title: d.title,
      value: d.value,
      pipeline_id: pipelineId,
      stage_id: stageId,
      user_id: superadminId,
      contact_id: contactIds[i % contactIds.length] ?? null,
      status: d.status ?? 'open',
    });
    if (error) console.error(`  Deal insert error: ${error.message}`);
  }
  console.log(`Deals: ${dealData.length}`);

  // ---- Message Templates ----
  const templates = [
    { name: 'Welcome Message', body_text: 'Hi {{1}}, welcome to our service! We are excited to have you on board.' },
    { name: 'Follow Up', body_text: 'Hi {{1}}, just checking in to see if you have any questions about our previous conversation.' },
    { name: 'Meeting Reminder', body_text: 'Hi {{1}}, this is a reminder about our meeting scheduled for {{2}}.' },
  ];
  for (const t of templates) {
    const { data: existing } = await admin.from('message_templates').select('id').eq('name', t.name).eq('user_id', superadminId).maybeSingle();
    if (existing) continue;
    const { error } = await admin.from('message_templates').insert({
      name: t.name,
      body_text: t.body_text,
      user_id: superadminId,
      category: 'Marketing',
    });
    if (error) console.error(`  Template insert error: ${error.message}`);
  }
  console.log(`Templates: ${templates.length}`);

  console.log('\n✓ Demo data seeded!');
  console.log('  Superadmin: superadmin@gmail.com / 123456 (active, full access)');
  console.log('  Demo user:  demo@gmail.com / 123456 (pending, not yet approved)');
  console.log('\nInstructions:');
  console.log('  1. Run supabase/seed.sql in the Supabase SQL Editor first');
  console.log('  2. Then run: node scripts/seed-demo.mjs');
  console.log('  3. Login as superadmin and approve "Demo User" in /admin/users');
}

main().catch(console.error);
