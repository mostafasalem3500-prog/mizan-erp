-- Follow-up tasks & reminders (per company, assignable to a member), and the monthly sales target.
CREATE TABLE IF NOT EXISTS tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         text NOT NULL,
  notes         text,
  due_date      date,
  priority      text NOT NULL DEFAULT 'NORMAL',     -- LOW | NORMAL | HIGH
  status        text NOT NULL DEFAULT 'OPEN',       -- OPEN | DONE
  assigned_to   uuid,                               -- users.id (null = whoever)
  assigned_name text,
  link          text,                               -- a screen in the program, e.g. /customers/<id>
  created_by    uuid NOT NULL,
  created_name  text,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_idx ON tasks(company_id, status, due_date);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS targets jsonb NOT NULL DEFAULT '{}'::jsonb;   -- { monthlySales }
