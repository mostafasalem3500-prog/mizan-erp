-- 3.53.0: employee self-service — a private link per employee (payslips, leave balance, documents, leave requests),
-- checked with the last four digits of the employee's ID; requests from it are marked as coming from the portal.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS portal_token uuid;
CREATE UNIQUE INDEX IF NOT EXISTS employees_portal_token_idx ON employees (portal_token) WHERE portal_token IS NOT NULL;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS via text;   -- PORTAL when the employee asked from the self-service link
