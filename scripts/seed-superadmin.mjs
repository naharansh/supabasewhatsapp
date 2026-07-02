import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceKey) {
  console.error('Missing env vars — check .env.local');
  process.exit(1);
}

async function main() {
  // 1. Sign up using anon client (same as app signup)
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await anonClient.auth.signUp({
    email: 'superadmin@gmail.com',
    password: '123456',
    options: {
      data: { full_name: 'Super Admin', role: 'superadmin' },
    },
  });

  if (error) {
    console.error('Sign up failed:', error.message);
    process.exit(1);
  }

  console.log('User created:', data.user?.id);

  // 2. Use admin client to confirm email + update role
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  if (data.user?.id) {
    // confirm email
    const { error: confirmErr } = await adminClient.auth.admin.updateUserById(
      data.user.id,
      { email_confirm: true }
    );
    if (confirmErr) {
      console.error('Email confirm failed:', confirmErr.message);
    } else {
      console.log('Email confirmed');
    }

    // update profile role
    const { error: profileErr } = await adminClient
      .from('profiles')
      .update({ role: 'superadmin' })
      .eq('user_id', data.user.id);

    if (profileErr) {
      console.error('Profile role update failed:', profileErr.message);
    } else {
      console.log('Profile role set to superadmin');
    }
  }

  console.log('Done — login with superadmin@gmail.com / 123456');
}

main();
