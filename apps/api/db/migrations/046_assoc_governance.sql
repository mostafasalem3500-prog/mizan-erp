-- Associations: financial authority matrix (multi-level approvals), governance (meetings & decisions),
-- grants from donor entities, and the non-profit statements

ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS authority jsonb NOT NULL DEFAULT '{}'::jsonb;  -- {enabled, directLimit, separation, levels:[{upTo,title,approvals,decision}]}
ALTER TABLE charity_requests ADD COLUMN IF NOT EXISTS approvals jsonb NOT NULL DEFAULT '[]'::jsonb;   -- [{by, at, note}]
ALTER TABLE charity_requests ADD COLUMN IF NOT EXISTS decision_id uuid;

CREATE TABLE IF NOT EXISTS assoc_meetings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number        text NOT NULL,
  kind          text NOT NULL DEFAULT 'BOARD',      -- BOARD | GA | EGA | COMMITTEE
  title         text,
  date          date NOT NULL,
  location      text,
  members_total int NOT NULL DEFAULT 0,
  attendees     jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{name, role, present}]
  agenda        text,
  minutes       text,
  status        text NOT NULL DEFAULT 'DRAFT',      -- DRAFT | APPROVED
  is_demo       boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE IF NOT EXISTS assoc_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  meeting_id  uuid REFERENCES assoc_meetings(id) ON DELETE SET NULL,
  number      text NOT NULL,
  date        date NOT NULL,
  text        text NOT NULL,
  category    text NOT NULL DEFAULT 'ADMIN',          -- FINANCIAL | PROGRAM | ADMIN | HR | OTHER
  amount      numeric(18,2),
  project_id  uuid REFERENCES charity_projects(id),
  owner       text,
  due_date    date,
  status      text NOT NULL DEFAULT 'OPEN',           -- OPEN | DONE | CANCELLED
  done_at     date,
  done_note   text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE IF NOT EXISTS assoc_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  title        text NOT NULL,
  partner_id   uuid REFERENCES partners(id),
  grantor_name text NOT NULL,
  agreement_no text,
  project_id   uuid REFERENCES charity_projects(id),
  amount       numeric(18,2) NOT NULL,
  start_date   date,
  end_date     date,
  tranches     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{dueDate, amount}]
  reports      jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{dueDate, title, submittedAt, note}]
  status       text NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE | CLOSED
  notes        text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS grant_id uuid REFERENCES assoc_grants(id);
