WITH params AS (
  SELECT
    ARRAY['Avery','Blake','Casey','Devon','Emery','Finley','Harper','Jordan','Kai','Logan',
          'Morgan','Noel','Parker','Quinn','Riley','Rowan','Sage','Skyler','Taylor','Winter'] AS first_names,
    ARRAY['Abbott','Brennan','Castillo','Duarte','Ekwueme','Fischer','Goldberg','Haddad','Ivanova','Jansen',
          'Kowalski','Lindqvist','Moreau','Nakamura','Okafor','Petrov','Quintero','Rossi','Schmidt','Tanaka'] AS last_names,
    ARRAY['GB','US','DE','FR','ES','IT','NL','IE','SE','PL','PT','CA'] AS countries,
    date_trunc('minute', now()) AS seeded_at
), generated AS (
  SELECT
    n,
    p.*,
    CASE
      WHEN n = 1 THEN 85
      WHEN n = 2 THEN 25
      ELSE ((n * 7919 + n / 13) % 101)
    END AS risk,
    CASE
      WHEN n <= 10 THEN 'new'
      WHEN n % 20 < 10 THEN 'new'
      WHEN n % 20 < 14 THEN 'in_review'
      WHEN n % 20 < 16 THEN 'escalated'
      WHEN n % 20 < 18 THEN 'approved'
      ELSE 'rejected'
    END AS case_status,
    p.seeded_at - make_interval(days => (n * 31) % 90, mins => (n * 17) % 1440) AS opened_at
  FROM generate_series(1, 50000) AS n
  CROSS JOIN params p
)
INSERT INTO kyc.cases (
  id, reference, customer_name, date_of_birth, national_id, country, risk_score,
  status, assignee, sla_due_at, created_at, updated_at, decided_by, decided_at
)
SELECT
  md5('kyc-seed-case-' || n)::uuid,
  'KYC-' || lpad(n::text, 6, '0'),
  first_names[(n % 20) + 1] || ' ' || last_names[((n / 20) % 20) + 1],
  DATE '1950-01-01' + ((n * 7919) % 20000),
  'SYN-' || countries[((n * 7) % 12) + 1] || '-' || lpad(((n::bigint * 104729) % 1000000000)::text, 9, '0'),
  countries[((n * 7) % 12) + 1],
  risk,
  case_status,
  CASE
    WHEN case_status = 'new' THEN NULL
    WHEN case_status = 'in_review' THEN 'kyc-analyst'
    ELSE 'seed-analyst-' || (n % 5 + 1)
  END,
  opened_at + CASE WHEN risk >= 70 THEN interval '24 hours' ELSE interval '72 hours' END,
  opened_at,
  opened_at,
  CASE WHEN case_status IN ('approved','rejected') THEN 'seed-analyst-' || (n % 5 + 1) END,
  CASE WHEN case_status IN ('approved','rejected') THEN opened_at + interval '6 hours' END
FROM generated
ON CONFLICT (id) DO NOTHING;
