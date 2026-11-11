-- Daily attendance; the month's lateness, absence and overtime become payroll transactions.
CREATE TABLE IF NOT EXISTS attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date           date NOT NULL,
  status         text NOT NULL DEFAULT 'PRESENT',   -- PRESENT | ABSENT | LEAVE | OFF (weekly rest / holiday)
  time_in        text,                              -- HH:MM
  time_out       text,
  hours          numeric(6,2) NOT NULL DEFAULT 0,   -- worked
  late_minutes   int NOT NULL DEFAULT 0,
  overtime_hours numeric(6,2) NOT NULL DEFAULT 0,
  note           text,
  source         text NOT NULL DEFAULT 'MANUAL',    -- MANUAL | IMPORT
  created_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS attendance_idx ON attendance(company_id, date);
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS source text;   -- ATTENDANCE for lines generated from the attendance sheet
