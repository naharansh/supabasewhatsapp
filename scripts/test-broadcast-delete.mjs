import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://yfqembxxiylbwjpdsrxd.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmcWVtYnh4aXlsYndqcGRzcnhkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI3NjA2MiwiZXhwIjoyMDk3ODUyMDYyfQ.vlfulkCklntmgGOC2eT7SNCfSQTyxkdHi67LpLCHwGc",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function test() {
  // First, create a test broadcast
  const { data: bc, error: bcErr } = await supabase
    .from("broadcasts")
    .insert({
      user_id: "00000000-0000-0000-0000-000000000000", // dummy
      name: "Test Broadcast for Delete",
      template_name: "test_template",
      template_language: "en_US",
      status: "draft",
    })
    .select()
    .single();

  if (bcErr) {
    console.log("CREATE FAILED:", bcErr.code, bcErr.message, bcErr.details);
    return;
  }
  console.log("Created broadcast:", bc.id);

  // Add a recipient
  const { error: recErr } = await supabase
    .from("broadcast_recipients")
    .insert({
      broadcast_id: bc.id,
      contact_id: "00000000-0000-0000-0000-000000000000",
      status: "pending",
    });

  if (recErr) {
    console.log("RECIPIENT INSERT FAILED:", recErr.code, recErr.message);
  } else {
    console.log("Added recipient");
  }

  // Now try to delete
  console.log("Attempting delete...");
  const { data, error } = await supabase
    .from("broadcasts")
    .delete()
    .eq("id", bc.id);

  if (error) {
    console.log("DELETE FAILED:");
    console.log("  code:", error.code);
    console.log("  message:", error.message);
    console.log("  details:", error.details);
    console.log("  hint:", error.hint);
    console.log("  isError:", error instanceof Error);
  } else {
    console.log("DELETE succeeded. Data:", JSON.stringify(data));
  }
}

test().catch((e) => console.log("UNCAUGHT:", e.message));
