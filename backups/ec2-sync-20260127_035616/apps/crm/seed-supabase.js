import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
try {
  const envFile = readFileSync(join(__dirname, ".env.local"), "utf8");
  envFile.split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (err) {
  console.error("Error: Could not read .env.local file");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Get the current user's ID (optional - only needed for tasks)
async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return null;
  }
  return user.id;
}

// Seed data (same as in seed.ts but for Supabase)
const seedData = {
  accounts: [
    {
      id: "a1111111-1111-1111-1111-111111111111",
      name: "Tiffany & Co. (Demo)",
      phone: "+1 212 555 0133",
      company_code: "TIFFANY",
      email_statement_of_account: "ap@tiffany-demo.example",
      billing_street: "727 Fifth Avenue, New York, NY",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "a2222222-2222-2222-2222-222222222222",
      name: "BaselRPA Partners (Demo)",
      phone: "+1 415 555 0188",
      company_code: "BASELRPA",
      email_statement_of_account: "claims@baselrpa-demo.example",
      billing_street: "100 Market St, San Francisco, CA",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "a3333333-3333-3333-3333-333333333333",
      name: "Singapore Medical Group",
      phone: "+65 6235 1234",
      company_code: "SMG",
      email_statement_of_account: "billing@smg.sg",
      billing_street: "290 Orchard Road, Singapore 238859",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "a4444444-4444-4444-4444-444444444444",
      name: "Corporate Health Solutions",
      phone: "+65 6789 0123",
      company_code: "CHS",
      email_statement_of_account: "accounts@chs.com.sg",
      billing_street: "1 Marina Boulevard, Singapore 018989",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  contacts: [
    {
      id: "c1111111-1111-1111-1111-111111111111",
      first_name: "Ava",
      last_name: "Sterling",
      email: "ava.sterling@example.com",
      phone: "+1 212 555 0101",
      mobile: "+1 212 555 0102",
      record_type: "Patient",
      account_id: "a2222222-2222-2222-2222-222222222222",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c2222222-2222-2222-2222-222222222222",
      first_name: "Noah",
      last_name: "Chen",
      email: "noah.chen@example.com",
      phone: "+1 415 555 0103",
      mobile: "+1 415 555 0104",
      record_type: "Patient",
      account_id: "a2222222-2222-2222-2222-222222222222",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c3333333-3333-3333-3333-333333333333",
      first_name: "Emma",
      last_name: "Tan",
      email: "emma.tan@example.com",
      phone: "+65 9123 4567",
      mobile: "+65 9123 4567",
      record_type: "Patient",
      account_id: "a3333333-3333-3333-3333-333333333333",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c4444444-4444-4444-4444-444444444444",
      first_name: "James",
      last_name: "Wong",
      email: "james.wong@example.com",
      phone: "+65 9876 5432",
      mobile: "+65 9876 5432",
      record_type: "Patient",
      account_id: "a4444444-4444-4444-4444-444444444444",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c5555555-5555-5555-5555-555555555555",
      first_name: "Dr. Sarah",
      last_name: "Lim",
      email: "sarah.lim@example.com",
      phone: "+65 6234 5678",
      mobile: "+65 9123 4567",
      record_type: "SSOC Staff",
      account_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c6666666-6666-6666-6666-666666666666",
      first_name: "Dr. Michael",
      last_name: "Koh",
      email: "michael.koh@example.com",
      phone: "+65 6789 1234",
      mobile: "+65 9876 5432",
      record_type: "Referral Source",
      account_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  projects: [
    {
      id: "p1111111-1111-1111-1111-111111111111",
      name: "Luxury Rehab Program (Demo)",
      account_id: "a2222222-2222-2222-2222-222222222222",
      active: true,
      category_1: "Clinic",
      category_2: "Corporate",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "p2222222-2222-2222-2222-222222222222",
      name: "Corporate Wellness Initiative",
      account_id: "a3333333-3333-3333-3333-333333333333",
      active: true,
      category_1: "Wellness",
      category_2: "Corporate",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "p3333333-3333-3333-3333-333333333333",
      name: "Occupational Health Screening",
      account_id: "a4444444-4444-4444-4444-444444444444",
      active: true,
      category_1: "Screening",
      category_2: "Corporate",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  cases: [
    {
      id: "k1111111-1111-1111-1111-111111111111",
      case_no: "C-000001",
      case_date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      patient_name: "Ava Sterling",
      contact_id: "c1111111-1111-1111-1111-111111111111",
      project_id: "p1111111-1111-1111-1111-111111111111",
      bill_to_company_id: "a2222222-2222-2222-2222-222222222222",
      type_of_case: "Orthopaedic",
      trigger_sms: false,
      notes: "Demo case: initial assessment + treatment plan.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "k2222222-2222-2222-2222-222222222222",
      case_no: "C-000002",
      case_date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
      patient_name: "Emma Tan",
      contact_id: "c3333333-3333-3333-3333-333333333333",
      project_id: "p2222222-2222-2222-2222-222222222222",
      bill_to_company_id: "a3333333-3333-3333-3333-333333333333",
      type_of_case: "Dental",
      trigger_sms: true,
      notes: "Regular checkup and cleaning.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "k3333333-3333-3333-3333-333333333333",
      case_no: "C-000003",
      case_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      patient_name: "James Wong",
      contact_id: "c4444444-4444-4444-4444-444444444444",
      project_id: "p3333333-3333-3333-3333-333333333333",
      bill_to_company_id: "a4444444-4444-4444-4444-444444444444",
      type_of_case: "Eye",
      trigger_sms: false,
      notes: "Vision screening for workplace safety.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  visits: [
    {
      id: "v1111111-1111-1111-1111-111111111111",
      visit_record_no: "V-000001",
      case_id: "k1111111-1111-1111-1111-111111111111",
      visit_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      patient_name: "Ava Sterling",
      total_amount: 180,
      amount_outstanding: 0,
      symptoms: "Demo: wrist pain improving.",
      treatment_detail: "Continue physiotherapy.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "v2222222-2222-2222-2222-222222222222",
      visit_record_no: "V-000002",
      case_id: "k1111111-1111-1111-1111-111111111111",
      visit_date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      patient_name: "Ava Sterling",
      total_amount: 120,
      amount_outstanding: 0,
      symptoms: "Demo: improved mobility.",
      treatment_detail: "Massage + strengthening.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "v3333333-3333-3333-3333-333333333333",
      visit_record_no: "V-000003",
      case_id: "k2222222-2222-2222-2222-222222222222",
      visit_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      patient_name: "Emma Tan",
      total_amount: 150,
      amount_outstanding: 150,
      symptoms: "Tooth sensitivity.",
      treatment_detail: "Cleaning and fluoride treatment.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "v4444444-4444-4444-4444-444444444444",
      visit_record_no: "V-000004",
      case_id: "k3333333-3333-3333-3333-333333333333",
      visit_date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      patient_name: "James Wong",
      total_amount: 200,
      amount_outstanding: 200,
      symptoms: "Eye strain from computer work.",
      treatment_detail: "Comprehensive eye exam.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  treatment_master: [
    {
      id: "t1111111-1111-1111-1111-111111111111",
      code: "PT-THER",
      name: "Physiotherapy Session",
      unit_price: 180,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "t2222222-2222-2222-2222-222222222222",
      code: "MASS",
      name: "Therapeutic Massage",
      unit_price: 120,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "t3333333-3333-3333-3333-333333333333",
      code: "CONSULT",
      name: "Consultation",
      unit_price: 50,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "t4444444-4444-4444-4444-444444444444",
      code: "DENTAL-CLEAN",
      name: "Dental Cleaning",
      unit_price: 150,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "t5555555-5555-5555-5555-555555555555",
      code: "EYE-EXAM",
      name: "Comprehensive Eye Exam",
      unit_price: 200,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  visit_treatments: [
    {
      id: "vt111111-1111-1111-1111-111111111111",
      visit_id: "v1111111-1111-1111-1111-111111111111",
      treatment_record_no: "VT-000001",
      treatment_master_id: "t1111111-1111-1111-1111-111111111111",
      quantity: 1,
      cost_per_unit: 180,
      line_cost: 180,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "vt222222-2222-2222-2222-222222222222",
      visit_id: "v2222222-2222-2222-2222-222222222222",
      treatment_record_no: "VT-000002",
      treatment_master_id: "t2222222-2222-2222-2222-222222222222",
      quantity: 1,
      cost_per_unit: 120,
      line_cost: 120,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "vt333333-3333-3333-3333-333333333333",
      visit_id: "v3333333-3333-3333-3333-333333333333",
      treatment_record_no: "VT-000003",
      treatment_master_id: "t4444444-4444-4444-4444-444444444444",
      quantity: 1,
      cost_per_unit: 150,
      line_cost: 150,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "vt444444-4444-4444-4444-444444444444",
      visit_id: "v4444444-4444-4444-4444-444444444444",
      treatment_record_no: "VT-000004",
      treatment_master_id: "t5555555-5555-5555-5555-555555555555",
      quantity: 1,
      cost_per_unit: 200,
      line_cost: 200,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  receipts: [
    {
      id: "r1111111-1111-1111-1111-111111111111",
      receipt_no: "R-000001",
      receipt_date: new Date().toISOString().slice(0, 10),
      transaction_type: "Receipt",
      receipt_from_account_id: "a2222222-2222-2222-2222-222222222222",
      receipt_amount: 300,
      amount_applied: 300,
      balance: 0,
      remarks: "Demo payment received.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "r2222222-2222-2222-2222-222222222222",
      receipt_no: "R-000002",
      receipt_date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      transaction_type: "Receipt",
      receipt_from_account_id: "a3333333-3333-3333-3333-333333333333",
      receipt_amount: 100,
      amount_applied: 0,
      balance: 100,
      remarks: "Partial payment pending.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "r3333333-3333-3333-3333-333333333333",
      receipt_no: "R-000003",
      receipt_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      transaction_type: "Credit Note",
      receipt_from_account_id: "a4444444-4444-4444-4444-444444444444",
      receipt_amount: 50,
      amount_applied: 0,
      balance: 50,
      remarks: "Credit adjustment for overpayment.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  receipt_visit_offsets: [
    {
      id: "o1111111-1111-1111-1111-111111111111",
      receipt_id: "r1111111-1111-1111-1111-111111111111",
      visit_id: "v1111111-1111-1111-1111-111111111111",
      rvo_record_no: "RVO-000001",
      amount_applied: 180,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "o2222222-2222-2222-2222-222222222222",
      receipt_id: "r1111111-1111-1111-1111-111111111111",
      visit_id: "v2222222-2222-2222-2222-222222222222",
      rvo_record_no: "RVO-000002",
      amount_applied: 120,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  tasks: [
    {
      id: "tsk11111-1111-1111-1111-111111111111",
      subject: "Call employer to confirm bill-to company",
      status: "Not Started",
      priority: "High",
      due_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      description: "Demo task: verify invoice recipient and payment instructions.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "tsk22222-2222-2222-2222-222222222222",
      subject: "Upload MC/LD to shared folder",
      status: "In Progress",
      priority: "Medium",
      due_date: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10),
      description: "Demo task: ensure patient documents are filed correctly.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "tsk33333-3333-3333-3333-333333333333",
      subject: "Follow up on outstanding payment",
      status: "Not Started",
      priority: "High",
      due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      description: "Contact SMG regarding R-000002 payment.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "tsk44444-4444-4444-4444-444444444444",
      subject: "Schedule follow-up appointment",
      status: "Completed",
      priority: "Low",
      due_date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      description: "Patient Emma Tan requested next visit.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
};

async function seedTable(tableName, rows, userId = null) {
  console.log(`\nSeeding ${tableName}...`);
  
  // Check if table exists and has data
  const { data: existing, error: checkError } = await supabase
    .from(tableName)
    .select("id")
    .limit(1);
  
  if (checkError) {
    console.error(`  ⚠️  Table ${tableName} may not exist or you don't have access. Error: ${checkError.message}`);
    return;
  }
  
  if (existing && existing.length > 0) {
    console.log(`  ⏭️  Table ${tableName} already has data, skipping...`);
    return;
  }
  
  // Add user_id to tasks
  const rowsToInsert = userId && tableName === "tasks" 
    ? rows.map(row => ({ ...row, user_id: userId }))
    : rows;
  
  const { error } = await supabase.from(tableName).insert(rowsToInsert);
  
  if (error) {
    console.error(`  ❌ Error seeding ${tableName}:`, error.message);
  } else {
    console.log(`  ✅ Seeded ${rows.length} rows into ${tableName}`);
  }
}

async function main() {
  console.log("🌱 Starting Supabase seed...\n");
  
  // Try to get current user (for tasks table which requires user_id)
  let userId = null;
  try {
    userId = await getCurrentUser();
    if (userId) {
      console.log(`✅ Authenticated as user: ${userId}\n`);
    } else {
      console.log("ℹ️  Not authenticated. Most tables will be seeded, but tasks table will be skipped.\n");
      console.log("   (Tasks require user_id. You can create tasks manually in the UI.)\n");
    }
  } catch (err) {
    console.log("ℹ️  Not authenticated. Most tables will be seeded, but tasks table will be skipped.\n");
  }
  
  // Seed in order (respecting foreign key constraints)
  await seedTable("accounts", seedData.accounts);
  await seedTable("contacts", seedData.contacts);
  await seedTable("projects", seedData.projects);
  await seedTable("cases", seedData.cases);
  await seedTable("visits", seedData.visits);
  await seedTable("treatment_master", seedData.treatment_master);
  await seedTable("visit_treatments", seedData.visit_treatments);
  await seedTable("receipts", seedData.receipts);
  await seedTable("receipt_visit_offsets", seedData.receipt_visit_offsets);
  
  if (userId) {
    await seedTable("tasks", seedData.tasks, userId);
  }
  
  console.log("\n✨ Seed complete!");
  console.log("\nNote: If some tables failed, they may not exist in your Supabase database yet.");
  console.log("You may need to create the tables first using SQL migrations.");
}

main().catch(console.error);
