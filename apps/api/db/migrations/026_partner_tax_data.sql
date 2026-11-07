-- Customer / supplier data required on a ZATCA tax invoice: national address (additional number, region),
-- buyer identification type (CRN, national ID, iqama…), second phone and contact person.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS additional_no text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone2 text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS id_type text;          -- CRN MOM MLS 700 SAG NAT GCC IQA PAS OTH
ALTER TABLE partners ADD COLUMN IF NOT EXISTS vat_exempt_reason text; -- organisation not registered for VAT (buyer then identified by id_type)
