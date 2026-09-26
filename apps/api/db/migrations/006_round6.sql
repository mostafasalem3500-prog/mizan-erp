-- Round 6: multi-currency, landed costs, price lists, bank statement import

-- ── currencies (rate = SAR per 1 unit of the currency) ─────────────────────
CREATE TABLE IF NOT EXISTS currencies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name_ar    text NOT NULL,
  symbol     text,
  rate       numeric(18,6) NOT NULL DEFAULT 1,
  decimals   int NOT NULL DEFAULT 2,
  is_active  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  date       date NOT NULL,
  rate       numeric(18,6) NOT NULL,
  UNIQUE (company_id, code, date)
);
-- seed the common set for every existing company (rates are indicative — editable from settings)
INSERT INTO currencies(company_id, code, name_ar, symbol, rate, decimals)
SELECT c.id, v.code, v.name_ar, v.symbol, v.rate, v.decimals FROM companies c
CROSS JOIN (VALUES
  ('SAR','ريال سعودي','ر.س',1,2), ('USD','دولار أمريكي','$',3.75,2), ('EUR','يورو','€',4.05,2), ('GBP','جنيه إسترليني','£',4.75,2),
  ('AED','درهم إماراتي','د.إ',1.0209,2), ('KWD','دينار كويتي','د.ك',12.2,3), ('BHD','دينار بحريني','د.ب',9.95,3), ('QAR','ريال قطري','ر.ق',1.03,2),
  ('OMR','ريال عماني','ر.ع',9.74,3), ('EGP','جنيه مصري','ج.م',0.078,2), ('INR','روبية هندية','₹',0.045,2), ('CNY','يوان صيني','¥',0.52,2), ('TRY','ليرة تركية','₺',0.11,2)
) AS v(code, name_ar, symbol, rate, decimals)
WHERE NOT EXISTS (SELECT 1 FROM currencies x WHERE x.company_id=c.id AND x.code=v.code);

ALTER TABLE partners ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS price_list_id uuid;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fc_total numeric(18,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fc_paid numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS price_list_id uuid;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS fc_unit_price numeric(18,4);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fc_amount numeric(18,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fx_diff numeric(18,2) NOT NULL DEFAULT 0;

-- ── landed costs (freight, customs, clearance → inventory cost) ───────────
CREATE TABLE IF NOT EXISTS landed_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number      text NOT NULL,
  date        date NOT NULL,
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  method      text NOT NULL DEFAULT 'VALUE', -- VALUE | QTY
  status      text NOT NULL DEFAULT 'DRAFT', -- DRAFT | POSTED
  costs       jsonb NOT NULL,   -- [{description, amount, accountId}] credit side (default: landed-cost clearing account)
  allocation  jsonb,            -- [{lineId, productId, description, qty, base, share, toInventory, toCogs}]
  total       numeric(18,2) NOT NULL DEFAULT 0,
  journal_id  uuid,
  notes       text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- ── price lists ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'FIXED', -- FIXED (per-product prices) | DISCOUNT (% off the sale price)
  discount_pct numeric(6,2) NOT NULL DEFAULT 0,
  currency     text NOT NULL DEFAULT 'SAR',
  is_active    boolean NOT NULL DEFAULT true,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS price_list_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_qty       numeric(12,3) NOT NULL DEFAULT 1,
  price         numeric(18,4) NOT NULL,
  UNIQUE (price_list_id, product_id, min_qty)
);

-- ── bank statement lines (imported) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id),
  date            date NOT NULL,
  description     text,
  reference       text,
  amount          numeric(18,2) NOT NULL, -- + deposit / − withdrawal
  balance         numeric(18,2),
  status          text NOT NULL DEFAULT 'OPEN', -- OPEN | MATCHED | IGNORED
  matched_line_id uuid REFERENCES journal_lines(id) ON DELETE SET NULL,
  batch           text,
  fingerprint     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bsl_account_idx ON bank_statement_lines(company_id, account_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS bsl_fingerprint_uq ON bank_statement_lines(account_id, fingerprint) WHERE fingerprint IS NOT NULL;

-- ── accounts ──────────────────────────────────────────────────────────────
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '4203', 'أرباح فروق عملة', 'FX Gains', 'REVENUE', 'OTHER_INCOME', p.id, 3, false, true, 'FX_GAIN'
FROM accounts p WHERE p.code='42' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='4203' OR x.system_key='FX_GAIN'));
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5404', 'خسائر فروق عملة', 'FX Losses', 'EXPENSE', 'OTHER_EXPENSE', p.id, 3, false, true, 'FX_LOSS'
FROM accounts p WHERE p.code='54' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5404' OR x.system_key='FX_LOSS'));
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5104', 'مصروفات شحن وجمارك وتخليص (تُحمَّل على المخزون)', 'Landed Costs Clearing', 'EXPENSE', 'COGS', p.id, 3, false, true, 'LANDED_COST'
FROM accounts p WHERE p.code='51' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5104' OR x.system_key='LANDED_COST'));

-- import VAT paid at customs is a liability to customs, not to the foreign supplier
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customs_vat numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customs_paid_journal_id uuid;
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '210204', 'ضريبة استيراد مستحقة للجمارك', 'Customs VAT Payable', 'LIABILITY', 'TAX', p.id, 4, false, true, 'CUSTOMS_PAYABLE'
FROM accounts p WHERE p.code='2102' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='210204' OR x.system_key='CUSTOMS_PAYABLE'));
