import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rpa/cleanup
 * Deletes all rows from rpa_extraction_runs (and optionally clears visit extraction data).
 * Body: { clearVisitExtraction?: boolean } — if true, clears extraction_metadata on visits where source = 'Clinic Assist'
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clearVisitExtraction = Boolean(body?.clearVisitExtraction);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 500 },
      );
    }

    const supabase = createClient(url, anonKey);

    const { data: existingRuns, error: selectError } = await supabase
      .from("rpa_extraction_runs")
      .select("id");

    if (selectError) {
      return NextResponse.json(
        {
          error: String(selectError.message ?? selectError),
          hint: "Check RLS policies for rpa_extraction_runs (SELECT).",
        },
        { status: 500 },
      );
    }

    const ids = (existingRuns ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No extraction runs to clean up.",
        deletedRuns: 0,
        clearedVisits: clearVisitExtraction ? 0 : undefined,
      });
    }

    const { data: deletedRuns, error: runsError } = await supabase
      .from("rpa_extraction_runs")
      .delete()
      .in("id", ids)
      .select("id");

    if (runsError) {
      return NextResponse.json(
        {
          error: String(runsError.message ?? runsError),
          hint: "If permission denied, add DELETE policy for rpa_extraction_runs or run cleanup in Supabase SQL Editor.",
        },
        { status: 500 },
      );
    }

    const deletedCount = deletedRuns?.length ?? 0;
    let visitUpdates = 0;

    if (clearVisitExtraction) {
      const { data: visits, error: visitError } = await supabase
        .from("visits")
        .select("id, extraction_metadata")
        .eq("source", "Clinic Assist")
        .not("extraction_metadata", "is", null);

      if (!visitError && visits?.length) {
        for (const v of visits) {
          const { error: up } = await supabase
            .from("visits")
            .update({ extraction_metadata: null })
            .eq("id", v.id);
          if (!up) visitUpdates += 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Cleaned up ${deletedCount} extraction run(s)${clearVisitExtraction ? ` and cleared extraction data for ${visitUpdates} visit(s).` : "."}`,
      deletedRuns: deletedCount,
      clearedVisits: clearVisitExtraction ? visitUpdates : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message ?? error) },
      { status: 500 },
    );
  }
}
