import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function main() {
  // Step 1: Try direct SQL via rpc to insert into auth.users
  // First check if the pgcrypto extension exists
  const { data: pgcryptoCheck, error: pgErr } = await supabase.rpc('exec_sql_bridge', {
    query: `SELECT crypt('123456', gen_salt('bf'))`,
  });
  console.log('pgcrypto check:', pgErr?.message ?? 'OK');

  // Step 2: Try to create user via SQL insert
  const { data, error } = await supabase.rpc('exec_sql_bridge', {
    query: `
      DO $$
      DECLARE
        _uid UUID := gen_random_uuid();
      BEGIN
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, confirmation_sent_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          _uid,
          'authenticated', 'authenticated',
          'superadmin@gmail.com',
          crypt('123456', gen_salt('bf')),
          NOW(), NOW(),
          '{"provider":"email","providers":["email"]}',
          '{"full_name":"Super Admin","role":"superadmin"}',
          NOW(), NOW()
        );
        INSERT INTO public.profiles (user_id, full_name, email, role)
        VALUES (_uid, 'Super Admin', 'superadmin@gmail.com', 'superadmin')
        ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin';
      END $$;
    `,
  });
  console.log('SQL insert result:', error?.message ?? JSON.stringify(data));
}

main().catch(console.error);
