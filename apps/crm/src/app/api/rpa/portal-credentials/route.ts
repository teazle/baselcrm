import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  encryptPortalSecret,
  hasPortalCredentialEncryptionKey,
} from "@/lib/rpa/portal-credentials-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TARGETS = new Set([
  "MHC",
  "ALLIANCE_MEDINET",
  "ALLIANZ",
  "FULLERTON",
  "IHP",
  "IXCHANGE",
  "GE_NTUC",
] as const);

type PortalTarget = "MHC" | "ALLIANCE_MEDINET" | "ALLIANZ" | "FULLERTON" | "IHP" | "IXCHANGE" | "GE_NTUC";

type PortalCredentialDbRow = {
  portal_target: string;
  label: string | null;
  portal_url: string | null;
  is_active: boolean | null;
  username: string | null;
  password: string | null;
  username_encrypted: string | null;
  password_encrypted: string | null;
  updated_at: string | null;
};

type PortalCredentialResponseRow = {
  portal_target: string;
  label: string | null;
  portal_url: string | null;
  is_active: boolean;
  has_username: boolean;
  has_password: boolean;
  updated_at: string | null;
};

function getBearerToken(request: Request): string | null {
  const header = String(request.headers.get("authorization") || "");
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice("bearer ".length).trim();
  return token || null;
}

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anonKey, serviceRoleKey };
}

function normalizePortalTarget(value: unknown): PortalTarget | null {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_TARGETS.has(normalized as PortalTarget)) return null;
  return normalized as PortalTarget;
}

function toResponseRow(row: PortalCredentialDbRow): PortalCredentialResponseRow {
  const hasUsername = Boolean(
    String(row?.username_encrypted || "").trim() || String(row?.username || "").trim(),
  );
  const hasPassword = Boolean(
    String(row?.password_encrypted || "").trim() || String(row?.password || "").trim(),
  );
  return {
    portal_target: String(row?.portal_target || "").trim(),
    label: row?.label || null,
    portal_url: row?.portal_url || null,
    is_active: row?.is_active !== false,
    has_username: hasUsername,
    has_password: hasPassword,
    updated_at: row?.updated_at || null,
  };
}

async function authenticateUser(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return { error: NextResponse.json({ error: "Missing Bearer token." }, { status: 401 }) };
  }

  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 500 }) };
  }

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }

  return { userId: data.user.id };
}

function createAdminClient() {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readAllCredentialRows() {
  const admin = createAdminClient();
  if (!admin) {
    return { error: NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required." }, { status: 500 }) };
  }
  const { data, error } = await admin
    .from("rpa_portal_credentials")
    .select(
      "portal_target,label,portal_url,is_active,username,password,username_encrypted,password_encrypted,updated_at",
    )
    .order("portal_target", { ascending: true });
  if (error) {
    return { error: NextResponse.json({ error: String(error.message || error) }, { status: 500 }) };
  }

  const rows = ((data || []) as PortalCredentialDbRow[])
    .filter((row) => normalizePortalTarget(row.portal_target))
    .map((row) => toResponseRow(row));
  return { rows };
}

export async function GET(request: Request) {
  const auth = await authenticateUser(request);
  if (auth.error) return auth.error;

  const read = await readAllCredentialRows();
  if (read.error) return read.error;

  return NextResponse.json({ rows: read.rows || [] });
}

export async function POST(request: Request) {
  const auth = await authenticateUser(request);
  if (auth.error) return auth.error;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is required." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const portalTarget = normalizePortalTarget(body?.portal_target);
  if (!portalTarget) {
    return NextResponse.json({ error: "Invalid portal_target." }, { status: 400 });
  }

  const { data: existing, error: existingError } = await admin
    .from("rpa_portal_credentials")
    .select(
      "portal_target,label,portal_url,is_active,username,password,username_encrypted,password_encrypted,crypto_version",
    )
    .eq("portal_target", portalTarget)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: String(existingError.message || existingError) }, { status: 500 });
  }

  const existingRow = (existing || null) as
    | (PortalCredentialDbRow & { crypto_version?: string | null })
    | null;

  const labelInput = typeof body?.label === "string" ? body.label.trim() : "";
  const portalUrlProvided = typeof body?.portal_url === "string";
  const portalUrlInput = portalUrlProvided ? String(body.portal_url).trim() : null;
  const isActiveInput = typeof body?.is_active === "boolean" ? body.is_active : null;
  const clearUsername = Boolean(body?.clearUsername);
  const clearPassword = Boolean(body?.clearPassword);
  const usernameInputRaw = typeof body?.username === "string" ? body.username.trim() : null;
  const passwordInputRaw = typeof body?.password === "string" ? body.password.trim() : null;
  const hasNewUsername = Boolean(usernameInputRaw);
  const hasNewPassword = Boolean(passwordInputRaw);

  if ((hasNewUsername || hasNewPassword) && !hasPortalCredentialEncryptionKey()) {
    return NextResponse.json(
      { error: "RPA_CREDENTIALS_ENCRYPTION_KEY is not set on server." },
      { status: 500 },
    );
  }

  let usernameEncrypted = String(existingRow?.username_encrypted || "").trim() || null;
  let passwordEncrypted = String(existingRow?.password_encrypted || "").trim() || null;
  let usernamePlain = String(existingRow?.username || "").trim() || null;
  let passwordPlain = String(existingRow?.password || "").trim() || null;

  if (clearUsername) {
    usernameEncrypted = null;
    usernamePlain = null;
  } else if (hasNewUsername && usernameInputRaw) {
    usernameEncrypted = encryptPortalSecret(usernameInputRaw);
    usernamePlain = null;
  } else if (!usernameEncrypted && usernamePlain && hasPortalCredentialEncryptionKey()) {
    usernameEncrypted = encryptPortalSecret(usernamePlain);
    usernamePlain = null;
  }

  if (clearPassword) {
    passwordEncrypted = null;
    passwordPlain = null;
  } else if (hasNewPassword && passwordInputRaw) {
    passwordEncrypted = encryptPortalSecret(passwordInputRaw);
    passwordPlain = null;
  } else if (!passwordEncrypted && passwordPlain && hasPortalCredentialEncryptionKey()) {
    passwordEncrypted = encryptPortalSecret(passwordPlain);
    passwordPlain = null;
  }

  const payload = {
    portal_target: portalTarget,
    label: labelInput || existingRow?.label || portalTarget,
    portal_url: portalUrlProvided ? portalUrlInput || null : existingRow?.portal_url || null,
    is_active: isActiveInput === null ? existingRow?.is_active !== false : isActiveInput,
    username_encrypted: usernameEncrypted,
    password_encrypted: passwordEncrypted,
    crypto_version: usernameEncrypted || passwordEncrypted ? "v1" : existingRow?.crypto_version || null,
    username: usernamePlain,
    password: passwordPlain,
    user_id: auth.userId,
  };

  const { data: saved, error: saveError } = await admin
    .from("rpa_portal_credentials")
    .upsert(payload, { onConflict: "portal_target" })
    .select(
      "portal_target,label,portal_url,is_active,username,password,username_encrypted,password_encrypted,updated_at",
    )
    .single();

  if (saveError) {
    return NextResponse.json({ error: String(saveError.message || saveError) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    row: toResponseRow(saved as PortalCredentialDbRow),
  });
}
