import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { runIds, date } = body;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 500 },
      );
    }

    const supabase = createClient(url, anonKey);

    let query = supabase
      .from("rpa_extraction_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: "Cancelled by user",
      })
      .in("status", ["in_progress", "running"]);

    // If specific run IDs are provided, filter by them
    if (runIds && Array.isArray(runIds) && runIds.length > 0) {
      query = query.in("id", runIds);
    }

    // If a date is provided, filter by runs started on that date
    if (date && typeof date === "string") {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(date)) {
        const startOfDay = `${date}T00:00:00.000Z`;
        const endOfDay = `${date}T23:59:59.999Z`;
        query = query
          .gte("started_at", startOfDay)
          .lte("started_at", endOfDay);
      }
    }

    const { data, error } = await query.select();

    if (error) {
      return NextResponse.json(
        { error: String(error.message ?? error) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Cancelled ${data?.length ?? 0} run(s).`,
      cancelled: data?.length ?? 0,
      runs: data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 },
    );
  }
}
