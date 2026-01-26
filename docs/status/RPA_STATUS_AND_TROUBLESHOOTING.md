# RPA Automation – Status & Troubleshooting

## What’s working

| Component | Status | Notes |
|-----------|--------|------|
| **RPA dashboard** (`/crm/rpa`) | ✅ Loads | Page returns 200, all sections render |
| **Build** | ✅ Passes | `npm run build` in `apps/crm` succeeds |
| **Extract Queue List API** | ✅ Responds | `POST /api/rpa/extract-queue-list` returns 200, spawns process |
| **Extract Visit Details API** | ✅ Responds | `POST /api/rpa/extract-visit-details` returns 200, spawns process |
| **Supabase** | ✅ Connected | Root `.env` has credentials; `visits` and `rpa_extraction_runs` work |
| **Manual extraction scripts** | ✅ Run | `extract-date-range.js`, `extract-visit-details-batch.js` execute when run locally |

---

## What’s failing or unclear

### 1. **Runs stuck as "running"**

**Symptom:** In **Activity Log** and **Real-time status**, many runs stay **"In progress"** and never move to **Completed** or **Failed**.

**Cause:**

- The API **spawns** extraction scripts as **detached** background processes and returns immediately.
- If the script **crashes**, is **killed** (e.g. Ctrl+C, timeout, OOM), or the **runtime exits** (e.g. serverless) before it updates the run, it never writes `status: 'completed'` or `status: 'failed'`.
- The run is created at start (`status: 'running'`) but the script exits before calling `_updateRun` with a terminal status.

**Result:** You see lots of **running** runs with `total_records: 0` (queue list) or low `completed_count` (visit details), and they never clear.

**Mitigation:** We now register `SIGINT`/`SIGTERM` handlers in `extract-date-range` and the visit-details extractor. If you **stop the script** (Ctrl+C) or it is **killed**, the active run is marked `failed` before exit. This reduces (but does not fully remove) stuck "running" runs.

---

### 2. **Queue list runs with `total_records: 0`**

**Symptom:** Queue list runs appear with **0 total records** and stay **running**.

**Cause:**

- Extraction fails **early**: e.g. browser startup, Clinic Assist login, or navigation (Reports → Queue List) fails.
- The script creates a run, then errors **before** it extracts any items or calls `_updateRun` with counts.
- If the process is **killed** (see above), we also never update.

---

### 3. **RPA UI shows "Supabase is not configured" or empty/errors**

**Symptom:** Dashboard, Activity Log, Visits table, etc. show **"Supabase is not configured"** or use **demo/mock** data. Or Supabase is configured but you still see **errors** or **empty** data.

**Causes and fixes:**

- **Missing env:** The RPA UI uses **browser** Supabase: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/crm`. If those are missing in `apps/crm/.env.local`, the app uses demo mode.  
  **Fix:** Add both vars to `apps/crm/.env.local` and restart `npm run dev`.

- **RLS blocking anon:** The UI uses the **anon** key. If RLS is enabled on `visits` or `rpa_extraction_runs` and there are **no policies** allowing `SELECT` for anon (or for your auth role), queries return empty or fail.  
  **Fix:** In Supabase → **Authentication → Policies**, add policies that allow `SELECT` on `visits` and `rpa_extraction_runs` for the roles your app uses (e.g. `anon`, or authenticated users). The automation scripts use the **service role** (bypasses RLS); the CRM UI does not. For `rpa_extraction_runs`, see the optional policy in `apps/crm/supabase-rpa-extraction-runs.sql`.

- **Wrong project or key:** Ensure `NEXT_PUBLIC_*` in `apps/crm` point to the **same** Supabase project as the backend scripts, and use the **anon** key (not the service role key) for the browser client.

---

### 4. **"Extract Queue List" for a date does nothing**

**Symptom:** You pick a date, click **Extract Queue List**, get a success message, but no new visits or run progress.

**Causes:**

- **Date already has data:** `extract-date-range` **skips** dates that already have Clinic Assist visits. If that date is fully backfilled, it exits quickly with "All dates in range already have data."
- **Process killed:** Script is killed before it can persist anything (see #1).
- **Browser/login failure:** Script fails before navigation; we often don’t surface that in the UI because the process runs headless/detached.

---

### 4b. **We always go to the Queue List report even when the queue is empty**

**What happens:** For date-based extraction (e.g. Extract Queue List from the RPA page), we **always** navigate to **Reports → Queue List**, search by date, then extract (Excel export or grid). We do **not** check the **live queue** (today’s queue) first. So even when the live queue is empty, we still go to the Queue List **report**.

**Why:** The **report** is date-based and can include historical dates. We **cannot know** the report has 0 rows for a given date without opening it, searching, and extracting. So we always go there. If the report returns 0 items, we log e.g. `Queue list report returned 0 items for YYYY-MM-DD (report may be empty for this date)` and skip saving.

**Summary:** Going to the report is required for date-based extraction. “Queue list empty” (live queue) does not change that; we use the report, not the live queue, for queue-list extraction by date.

---

### 5. **Spawning from API in production (e.g. Vercel)**

**Symptom:** Triggers from the RPA page work locally but not in production; runs often stuck **running** or never start.

**Cause:**

- On **Vercel** (and similar serverless), the API route runs in a **short-lived** function. After the HTTP response, the runtime can **tear down** the process.
- **Detached** child processes are typically **killed** when the function ends. The extraction never (or rarely) completes.

**Fix:** Run long-running extraction **outside** serverless:

- Use a **always-on worker** (e.g. separate Node process, Docker, or small VM) that runs the same scripts.
- Or use a **job queue** (e.g. Inngest, Trigger.dev, Bull) that runs workers elsewhere; the API only enqueues jobs.

---

## Quick checks

1. **RPA page:** Open `http://localhost:3000/crm/rpa`. If you see "Supabase is not configured", fix `NEXT_PUBLIC_*` in `apps/crm` (see #3).
2. **RLS check:** If the RPA page shows errors or empty data despite Supabase being configured:
   - Open browser DevTools → Console
   - Look for errors mentioning "permission denied" or "row-level security"
   - In Supabase Dashboard → Table Editor → `rpa_extraction_runs` → check if "RLS enabled" is ON
   - If RLS is ON, run the policy from `apps/crm/supabase-rpa-extraction-runs.sql` (see #3)
   - Same check for `visits` table if you use it in RPA
3. **APIs:**  
   `curl -X POST http://localhost:3000/api/rpa/extract-queue-list -H "Content-Type: application/json" -d '{"date":"2026-01-22"}'`  
   You should get `{"ok":true,"pid":...,"message":"Queue list extraction started for 2026-01-22."}`.
4. **DB:** From repo root, run a quick Supabase query (e.g. `rpa_extraction_runs`, `visits` with `source = 'Clinic Assist'`) to confirm connectivity and existing data.
5. **Scripts locally:**  
   `node src/examples/extract-date-range.js 2026-01-22 2026-01-22`  
   `node src/examples/extract-visit-details-batch.js`  
   Watch terminal output for errors (login, navigation, etc.).

---

## Run exit handler (reduces stuck "running" runs)

We added `src/utils/run-exit-handler.js` and wired it into:

- **extract-date-range**: Registers `SIGINT` / `SIGTERM` handlers. On Ctrl+C or kill, the current run is marked `failed` before exit. Normal completion or explicit failure still update the run and then `markRunFinalized()`, so the handler does nothing.
- **visit-details extractor** (`extractBatch`): Same idea. If the process is killed mid-batch, the run is marked `failed`.

This avoids leaving runs stuck as "running" when you stop the script or the process is killed. Crashes (e.g. uncaught exception) or serverless teardown can still leave runs stuck; run extraction in a long-lived worker for production.

---

## Single run per queue-list extraction (no duplicate runs)

When **extract-date-range** or **extract-daily** runs, we now create **one** `queue_list` run (from the script), not one per date. We added `skipRunLogging` to `extractFromReportsQueueList`: when the caller already tracks the run, we skip creating/updating `rpa_extraction_runs` inside the batch extractor. That removes duplicate "running" queue_list runs and keeps the activity log clearer.

---

## Summary

| Issue | Working? | What to do |
|-------|----------|------------|
| RPA page loads | ✅ | — |
| APIs spawn extraction | ✅ | — |
| Runs often stuck "running" | ⚠️ Improved | Exit handler marks run `failed` on SIGINT/SIGTERM. Use a worker in prod; avoid serverless for long-running extraction. |
| Queue list 0 records | ❌ | Fix early failures (browser/login/nav); check logs when running scripts manually. |
| UI "Supabase not configured" | Depends | Set `NEXT_PUBLIC_SUPABASE_*` in `apps/crm` |
| Extraction in serverless | ❌ | Use a worker or job queue for real extraction |
