import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rpa/delete-runs
 * Permanently deletes extraction runs by ID.
 * Body: { runIds: string[] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const runIds = body?.runIds;

    if (!Array.isArray(runIds) || runIds.length === 0) {
      return NextResponse.json(
        { error: "runIds array is required." },
        { status: 400 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 500 },
      );
    }

    const supabase = createClient(url, anonKey);

    const { data, error } = await supabase
      .from("rpa_extraction_runs")
      .delete()
      .in("id", runIds)
      .select("id");

    if (error) {
      return NextResponse.json(
        { error: String(error.message ?? error) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Deleted ${data?.length ?? 0} run(s).`,
      deleted: data?.length ?? 0,
      runIds: data?.map((r) => r.id) ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 },
    );
  }
}
