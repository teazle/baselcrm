-- Expand Flow 3 portal/tag coverage for additional TPA groups.

insert into public.rpa_portals (portal_code, label, status)
values
  ('MHC', 'MHC', 'supported'),
  ('AIA', 'AIA', 'supported'),
  ('AIACLIENT', 'AIACLIENT', 'supported'),
  ('AVIVA', 'AVIVA', 'supported'),
  ('SINGLIFE', 'SINGLIFE', 'supported'),
  ('MHCAXA', 'MHCAXA', 'supported'),
  ('TOKIOM', 'TOKIOM', 'supported'),
  ('ALLIANC', 'ALLIANC', 'supported'),
  ('ALLSING', 'ALLSING', 'supported'),
  ('AXAMED', 'AXAMED', 'supported'),
  ('PRUDEN', 'PRUDEN', 'supported'),
  ('ALLIANZ', 'ALLIANZ', 'unsupported'),
  ('ALLIANCE', 'ALLIANCE', 'unsupported'),
  ('FULLERT', 'FULLERT', 'unsupported'),
  ('IHP', 'IHP', 'unsupported'),
  ('PARKWAY', 'PARKWAY', 'unsupported'),
  ('ALL', 'ALL', 'unsupported'),
  ('ALLIMED', 'ALLIMED', 'unsupported'),
  ('GE', 'GE', 'unsupported'),
  ('NTUC_IM', 'NTUC_IM', 'unsupported')
on conflict (portal_code)
do update set
  label = excluded.label,
  status = excluded.status,
  updated_at = now();
