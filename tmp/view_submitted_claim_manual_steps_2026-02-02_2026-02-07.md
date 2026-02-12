# Manual Truth Check Steps (View Submitted Claim)

1. Open MHC/AIA/Singlife portals and navigate to `View Submitted Claim` (or equivalent claim history view).
2. For each `visit_id` row in `view_submitted_claim_truth_2026-02-02_2026-02-07.csv`, verify whether the draft/claim exists in portal.
3. Fill these columns in the CSV:
   - `portal_found`: `yes` or `no`
   - `portal_status`: visible status label from portal (e.g. Draft/Pending/Submitted)
   - `portal_reference`: claim ID/reference from portal if available
   - `evidence_path`: screenshot file path proving the observation
   - `notes`: any anomalies
4. Keep `SZENTIRMAY IBOLYA MARGARET / M4427511W` as accepted exception only if still not found in portal.
5. Re-run reconciliation generator after CSV is filled to compute true mismatches.
