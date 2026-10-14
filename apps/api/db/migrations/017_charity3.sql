-- Round 19: sponsorships, in-kind donations, volunteers

ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS sponsorship_id uuid;
ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS periods_count int;
ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS period_label text;

-- الكفالات: كافل (متبرع) ← مكفول (مستفيد) بمبلغ دوري
CREATE TABLE IF NOT EXISTS charity_sponsorships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number        text NOT NULL,
  sponsor_id    uuid NOT NULL REFERENCES partners(id),
  beneficiary_id uuid REFERENCES partners(id),
  kind          text NOT NULL DEFAULT 'ORPHAN',   -- ORPHAN | FAMILY | STUDENT | PATIENT | OTHER
  amount        numeric(18,2) NOT NULL,           -- per installment
  frequency     int NOT NULL DEFAULT 1,           -- months per installment (1,3,6,12)
  start_date    date NOT NULL,
  end_date      date,
  status        text NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | PAUSED | ENDED
  project_id    uuid REFERENCES charity_projects(id),
  notes         text,
  is_demo       boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- التبرعات العينية: أصناف بكميات وقيمة (متوسط مرجح) + مستندات استلام/توزيع
CREATE TABLE IF NOT EXISTS charity_inkind_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  unit        text NOT NULL DEFAULT 'حبة',
  category    text,
  qty         numeric(18,3) NOT NULL DEFAULT 0,
  value       numeric(18,2) NOT NULL DEFAULT 0,
  min_qty     numeric(18,3) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS charity_inkind_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number      text NOT NULL,
  date        date NOT NULL,
  kind        text NOT NULL,                     -- IN | OUT
  partner_id  uuid REFERENCES partners(id),
  party_name  text NOT NULL,
  project_id  uuid REFERENCES charity_projects(id),
  lines       jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{itemId,name,unit,qty,unitValue,value}]
  total       numeric(18,2) NOT NULL DEFAULT 0,
  notes       text,
  journal_id  uuid REFERENCES journal_entries(id),
  status      text NOT NULL DEFAULT 'POSTED',
  is_demo     boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- المتطوعون وساعات التطوع
CREATE TABLE IF NOT EXISTS charity_volunteers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  id_no       text,
  phone       text,
  email       text,
  city        text,
  skills      text,
  status      text NOT NULL DEFAULT 'ACTIVE',
  joined_at   date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS charity_volunteer_hours (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  volunteer_id uuid NOT NULL REFERENCES charity_volunteers(id) ON DELETE CASCADE,
  date         date NOT NULL,
  hours        numeric(8,2) NOT NULL,
  program      text,
  project_id   uuid REFERENCES charity_projects(id),
  task         text,
  approved_by  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ch_vh_idx ON charity_volunteer_hours(company_id, volunteer_id, date);
