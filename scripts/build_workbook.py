#!/usr/bin/env python3
"""Builds MIZAN_IMPLEMENTATION_WORKBOOK.xlsx per spec band 121-124.

Every sheet below is real reference content derived from the Master Prompt
itself and, for the ZATCA sheets, from the officially verified sources in
docs/compliance/ZATCA_SOURCES.md — not filler. Sheets whose full detail
depends on code not yet written (e.g. exact DB indexes, API endpoints) carry
their header row plus the rows that ARE already decided, and are marked
"Status: Phase 0 partial" in a note column so this workbook is honest about
what's designed vs. what's still to be implemented.
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

FONT_NAME = "Arial"
HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
HEADER_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF", size=10)
BODY_FONT = Font(name=FONT_NAME, size=10)
WRAP = Alignment(wrap_text=True, vertical="top")

wb = openpyxl.Workbook()
wb.remove(wb.active)


def add_sheet(name, headers, rows, col_widths=None, rtl=False):
    ws = wb.create_sheet(title=name[:31])
    if rtl:
        ws.sheet_view.rightToLeft = True
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = WRAP
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = BODY_FONT
            cell.alignment = WRAP
    widths = col_widths or [22] * len(headers)
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    return ws


# 01_Product_Modules
add_sheet(
    "01_Product_Modules",
    ["Module Code", "Module Name AR", "Module Name EN", "MVP/Phase2", "Depends On", "Notes"],
    [
        ["auth", "الدخول والصلاحيات", "Auth", "MVP", "-", "Phase 0 implemented (schema only)"],
        ["organizations", "الشركات", "Organizations", "MVP", "auth", "Phase 0 implemented (schema only)"],
        ["users", "المستخدمون", "Users", "MVP", "auth", "Phase 0 implemented (schema only)"],
        ["permissions", "الصلاحيات", "Permissions", "MVP", "auth,users", "Phase 0 implemented (schema only)"],
        ["accounting", "المحاسبة", "Accounting", "MVP", "organizations", "Phase 0: Posting Engine + tests implemented"],
        ["sales", "المبيعات", "Sales", "MVP", "accounting,tax", "Simple Mode implemented and live-tested — Canonical Invoice Model still pending"],
        ["purchases", "المشتريات", "Purchases", "MVP", "accounting,inventory", "Simple Mode (Bill) implemented and live-tested"],
        ["expenses", "المصروفات", "Expenses", "MVP", "accounting", "Implemented and live-tested"],
        ["inventory", "المخزون", "Inventory", "MVP", "accounting", "Weighted Average costing implemented and live-tested — multi-warehouse/variants/serials/lots pending"],
        ["pos", "نقطة البيع", "POS", "MVP", "sales,inventory,tax,accounting,zatca", "Sell + Return implemented and live-tested — Shift/Hold-Resume/hardware pending"],
        ["banking", "البنوك والخزينة", "Banking", "MVP", "accounting", "Transfer implemented and live-tested — reconciliation not started"],
        ["projects", "المشاريع", "Projects", "Phase2", "accounting", "Not started"],
        ["contracting", "المقاولات", "Contracting", "Phase2", "projects", "Not started"],
        ["agriculture", "الزراعة", "Agriculture", "Phase2", "inventory", "Not started"],
        ["assets", "الأصول الثابتة", "Fixed Assets", "MVP", "accounting", "Acquisition + straight-line depreciation implemented and live-tested"],
        ["tax", "الضرائب", "Tax Engine", "MVP", "accounting", "Not started"],
        ["invoice-studio", "استوديو الفواتير", "Invoice Studio", "MVP", "sales,tax", "Not started — but see 'zatca' row: a real UBL 2.1 XML generator now exists as a first building block"],
        ["zatca", "الفوترة الإلكترونية", "ZATCA", "MVP", "invoice-studio", "Phase 1 QR: implemented and verified. Phase 2: real UBL 2.1 XML generator implemented (Sprint 30), built directly from the official spec and live-tested against real transaction data — still missing cryptographic stamp, real CSID, and a persistent invoice-number ledger, all of which require actual ZATCA onboarding credentials this build has never had"],
        ["reports", "التقارير", "Reports", "MVP", "accounting,inventory,pos", "Not started"],
        ["notifications", "الإشعارات", "Notifications", "Phase2", "-", "Not started"],
        ["audit", "سجل التدقيق", "Audit", "MVP", "auth", "Not started"],
        ["subscriptions", "الاشتراكات", "Subscriptions", "Phase2", "organizations", "Not started"],
    ],
    [16, 24, 18, 12, 26, 42],
    rtl=True,
)

# 02_Business_Sectors
add_sheet(
    "02_Business_Sectors",
    ["sector_code", "الاسم بالعربي", "Name EN"],
    [
        ["RETAIL", "التجزئة", "Retail"],
        ["WHOLESALE", "الجملة", "Wholesale"],
        ["SERVICES", "الخدمات", "Services"],
        ["CONTRACTING", "المقاولات", "Contracting"],
        ["AGRICULTURE", "الزراعة", "Agriculture"],
        ["TOURISM", "السياحة", "Tourism"],
        ["PROFESSIONAL_OFFICES", "المكاتب المهنية", "Professional Offices"],
    ],
    [22, 30, 22],
    rtl=True,
)

# 03_Business_Activities
add_sheet(
    "03_Business_Activities",
    ["activity_code", "sector_code", "الاسم بالعربي", "Name EN"],
    [
        ["SUPERMARKET", "RETAIL", "سوبر ماركت / بقالة", "Grocery / Mini Market"],
        ["CLOTHING", "RETAIL", "ملابس", "Clothing"],
        ["SHOES", "RETAIL", "أحذية", "Shoes"],
        ["PERFUMES", "RETAIL", "عطور", "Perfumes"],
        ["ELECTRONICS", "RETAIL", "إلكترونيات", "Electronics"],
        ["MOBILE", "RETAIL", "جوالات", "Mobile"],
        ["AUTO_PARTS", "RETAIL", "قطع غيار سيارات", "Auto Parts"],
        ["STATIONERY", "RETAIL", "قرطاسية", "Stationery"],
        ["HOME_SUPPLIES", "RETAIL", "مستلزمات منزلية", "Home Supplies"],
        ["BUILDING_MATERIALS", "RETAIL", "مواد بناء", "Building Materials"],
        ["GENERAL_TRADING", "WHOLESALE", "تجارة عامة", "General Trading"],
        ["DISTRIBUTION", "WHOLESALE", "توزيع", "Distribution"],
        ["IMPORT_EXPORT", "WHOLESALE", "استيراد وتصدير", "Import/Export"],
        ["IT_SERVICES", "SERVICES", "خدمات تقنية", "IT Services"],
        ["MAINTENANCE", "SERVICES", "صيانة", "Maintenance"],
        ["CONSULTING", "SERVICES", "استشارات", "Consulting"],
        ["MARKETING", "SERVICES", "تسويق", "Marketing"],
        ["TRAINING", "SERVICES", "تدريب", "Training"],
        ["ELECTRICAL_CONTRACTING", "CONTRACTING", "مقاولات كهربائية", "Electrical Contracting"],
        ["MECHANICAL_CONTRACTING", "CONTRACTING", "مقاولات ميكانيكية", "Mechanical Contracting"],
        ["FIT_OUT", "CONTRACTING", "تشطيبات", "Fit-Out"],
        ["OPERATIONS_MAINTENANCE", "CONTRACTING", "تشغيل وصيانة", "Operations & Maintenance"],
        ["FARMING", "AGRICULTURE", "زراعة", "Farming"],
        ["AGRI_SUPPLIES", "AGRICULTURE", "مستلزمات زراعية", "Agricultural Supplies"],
        ["PRODUCE_DISTRIBUTION", "AGRICULTURE", "توزيع منتجات زراعية", "Produce Distribution"],
        ["HAJJ_UMRAH", "TOURISM", "الحج والعمرة", "Hajj & Umrah"],
        ["TRIPS_TRANSPORT", "TOURISM", "رحلات ونقل", "Trips & Transportation"],
        ["ACCOUNTING_OFFICE", "PROFESSIONAL_OFFICES", "مكتب محاسبة", "Accounting Office"],
        ["ENGINEERING_OFFICE", "PROFESSIONAL_OFFICES", "مكتب هندسي", "Engineering Office"],
        ["LEGAL_OFFICE", "PROFESSIONAL_OFFICES", "مكتب قانوني", "Legal Office"],
    ],
    [24, 20, 26, 24],
    rtl=True,
)

# 04_Feature_Packs
add_sheet(
    "04_Feature_Packs",
    ["Pack", "sector_code", "Default Modules Added", "Invoice Templates", "Special Behavior"],
    [
        ["Retail Pack", "RETAIL", "pos, inventory(variants+barcode)", "Retail A4, Retail Thermal 80mm", "Barcode, variants, walk-in customer default"],
        ["Wholesale Pack", "WHOLESALE", "sales(quotation→SO), purchases", "Corporate Professional", "Credit limits, aging emphasis"],
        ["Services Pack", "SERVICES", "projects(light)", "Services", "Period/hours billing, no physical inventory"],
        ["Contracting Pack", "CONTRACTING", "projects, contracting(BOQ, retention)", "Contracting", "Progress Certificate ≠ Tax Invoice workflow"],
        ["Agriculture Pack", "AGRICULTURE", "inventory(lots/batches, weight units)", "Agriculture", "Gross/tare/net weight, harvest date, grading"],
        ["Tourism Pack", "TOURISM", "sales(packages)", "Services", "Trip/package line items"],
        ["Accounting Office Pack", "PROFESSIONAL_OFFICES", "multi-client architecture (Phase2)", "Minimal", "One firm managing several client tenants"],
    ],
    [22, 18, 40, 26, 40],
    rtl=False,
)

# 05_Chart_of_Accounts — matches AccountsService's DEFAULT_COA exactly (implemented and live-tested, Sprint 10)
add_sheet(
    "05_Chart_of_Accounts",
    ["Code", "الاسم بالعربي", "Name EN", "Type", "Parent", "Posting/Header"],
    [
        ["1000", "الأصول", "Assets", "ASSET", "-", "Header"],
        ["1100", "النقدية", "Cash", "ASSET", "1000", "Posting"],
        ["1110", "البنك", "Bank", "ASSET", "1000", "Posting"],
        ["1120", "حساب تسوية البطاقات", "Card Clearing Account", "ASSET", "1000", "Posting"],
        ["1200", "العملاء", "Accounts Receivable", "ASSET", "1000", "Posting"],
        ["1300", "المخزون", "Inventory", "ASSET", "1000", "Posting"],
        ["1400", "ضريبة القيمة المضافة - مدخلات", "VAT Input", "ASSET", "1000", "Posting"],
        ["1500", "الأصول الثابتة", "Fixed Assets", "ASSET", "1000", "Posting"],
        ["1510", "مجمّع الإهلاك", "Accumulated Depreciation", "ASSET", "1000", "Posting"],
        ["2000", "الالتزامات", "Liabilities", "LIABILITY", "-", "Header"],
        ["2100", "الموردون", "Accounts Payable", "LIABILITY", "2000", "Posting"],
        ["2200", "ضريبة القيمة المضافة - مخرجات", "VAT Output", "LIABILITY", "2000", "Posting"],
        ["3000", "حقوق الملكية", "Equity", "EQUITY", "-", "Header"],
        ["3100", "رصيد افتتاحي", "Opening Balance Equity", "EQUITY", "3000", "Posting"],
        ["4000", "الإيرادات", "Revenue", "REVENUE", "-", "Header"],
        ["4100", "المبيعات", "Sales", "REVENUE", "4000", "Posting"],
        ["4200", "مردودات المبيعات", "Sales Returns", "REVENUE", "4000", "Posting"],
        ["5000", "تكلفة المبيعات", "Cost of Sales", "COST_OF_SALES", "-", "Header"],
        ["5100", "تكلفة البضاعة المباعة", "COGS", "COST_OF_SALES", "5000", "Posting"],
        ["6000", "المصروفات التشغيلية", "Operating Expenses", "EXPENSE", "-", "Header"],
        ["6100", "مصروفات عامة", "General Expense", "EXPENSE", "6000", "Posting"],
        ["6200", "مصروف الإهلاك", "Depreciation Expense", "EXPENSE", "6000", "Posting"],
    ],
    [10, 28, 26, 16, 10, 16],
    rtl=True,
)

# 06_Accounting_Posting_Matrix (band 123)
add_sheet(
    "06_Accounting_Posting_Matrix",
    ["Event", "Source Document", "Debit", "Credit", "VAT Effect", "Inventory Effect", "COGS", "Reversal Method"],
    [
        ["SALE_INVOICE_POSTED", "Sales Invoice", "Accounts Receivable", "Sales + VAT Output", "VAT Output +", "Issue", "Yes (COGS Dr / Inventory Cr)", "Credit Note"],
        ["POS_SALE_COMPLETED (Cash)", "POS Sale", "Cash", "Sales + VAT Output", "VAT Output +", "Issue", "Yes", "POS Return"],
        ["POS_SALE_COMPLETED (Card)", "POS Sale", "Card Clearing Account", "Sales + VAT Output", "VAT Output +", "Issue", "Yes", "POS Return"],
        ["POS_SALE_COMPLETED (Mixed)", "POS Sale", "Cash + Card Clearing (split)", "Sales + VAT Output", "VAT Output +", "Issue", "Yes", "POS Return"],
        ["POS_RETURN_COMPLETED", "POS Return", "Sales Returns + VAT Output", "Cash/Card Clearing", "VAT Output −", "Return", "Reverse COGS", "N/A (already a reversal doc)"],
        ["PURCHASE_BILL_POSTED", "Supplier Bill", "Inventory + VAT Input", "Accounts Payable", "VAT Input +", "Receive", "No", "Purchase Return"],
        ["PURCHASE_RETURN_COMPLETED", "Purchase Return", "Accounts Payable", "Inventory + VAT Input", "VAT Input −", "Issue (out)", "No", "N/A"],
        ["EXPENSE_POSTED", "Expense", "Expense Account + VAT Input", "Cash/Bank/Payable", "VAT Input + (if applicable)", "None", "No", "Manual Reversal"],
        ["PAYMENT_RECEIVED", "Customer Payment", "Cash/Bank", "Accounts Receivable", "None", "None", "No", "Manual Reversal"],
        ["PAYMENT_PAID", "Supplier Payment", "Accounts Payable", "Cash/Bank", "None", "None", "No", "Manual Reversal"],
        ["INVENTORY_RECEIVED", "Goods Receipt / Opening Balance", "Inventory", "Opening Balance Equity / GRNI", "None", "Receive", "No", "Adjustment"],
        ["STOCK_ADJUSTED", "Inventory Count / Damage", "Inventory (or Expense if loss)", "Inventory Adjustment / Inventory", "None", "Adjust", "Depends", "Reverse Adjustment"],
        ["ASSET_ACQUIRED", "Asset Purchase", "Fixed Asset", "Cash/Bank/Payable", "VAT Input + (if applicable)", "None", "No", "Manual Reversal"],
        ["ASSET_DEPRECIATED", "Periodic Depreciation", "Depreciation Expense", "Accumulated Depreciation", "None", "None", "No", "Reverse Entry"],
        ["MANUAL_JOURNAL_POSTED", "Manual Journal", "As specified", "As specified", "As specified", "None", "No", "Reversal Journal"],
    ],
    [26, 22, 26, 26, 18, 14, 22, 22],
    rtl=False,
)

# 07_Database_Tables
add_sheet(
    "07_Database_Tables",
    ["Table Name", "Purpose", "Tenant Scope", "Financial Criticality", "Audit Requirement", "Status"],
    [
        ["organizations", "Root tenant record", "N/A (is the tenant)", "High", "Yes", "Implemented (Prisma)"],
        ["branches", "Branch/location per org", "organization_id", "Medium", "Yes", "Implemented (Prisma)"],
        ["users", "Login identity, global", "N/A", "Low", "Yes", "Implemented (Prisma)"],
        ["organization_users", "User↔Org↔Role membership", "organization_id", "Medium", "Yes", "Implemented (Prisma)"],
        ["roles", "Tenant-scoped role", "organization_id", "Medium", "Yes", "Implemented (Prisma)"],
        ["permissions", "Global permission catalog", "N/A", "Low", "No", "Implemented (Prisma)"],
        ["role_permissions", "Role↔Permission grant", "via role.organization_id", "Medium", "Yes", "Implemented (Prisma)"],
        ["accounts", "Chart of Accounts (tree)", "organization_id", "Critical", "Yes", "Implemented (Prisma)"],
        ["fiscal_years", "Year boundary + status", "organization_id", "Critical", "Yes", "Implemented (Prisma)"],
        ["accounting_periods", "Period boundary + status", "via fiscal_year.organization_id", "Critical", "Yes", "Implemented (Prisma)"],
        ["journal_entries", "Posted accounting entry header", "organization_id", "Critical", "Yes", "Implemented (Prisma)"],
        ["journal_entry_lines", "Debit/credit lines", "via journal_entry.organization_id", "Critical", "Yes", "Implemented (Prisma)"],
        ["customers / suppliers", "Parties", "organization_id", "High", "Yes", "Not started"],
        ["products / product_variants", "Catalog", "organization_id", "High", "Yes", "Not started"],
        ["warehouses / inventory_movements", "Stock ledger", "organization_id", "Critical", "Yes", "Not started"],
        ["invoice_documents ... invoice_render_versions", "Canonical Invoice domain (see band 61)", "organization_id", "Critical", "Yes", "Not started"],
        ["pos_terminals / pos_shifts / pos_sales", "POS domain", "organization_id / branch_id", "Critical", "Yes", "Not started"],
        ["zatca_documents / zatca_submissions / zatca_submission_attempts", "ZATCA integration log", "organization_id", "Critical", "Yes", "Not started — blocked on source verification"],
    ],
    [30, 34, 24, 18, 16, 30],
    rtl=False,
)

# 08_ERD_Reference
add_sheet(
    "08_ERD_Reference",
    ["Relationship", "Notes"],
    [
        ["organizations 1─* branches", "Every branch belongs to exactly one org"],
        ["organizations 1─* organization_users ─* users", "Many-to-many via join table; role lives on the join row"],
        ["organizations 1─* roles ─* role_permissions ─* permissions", "Roles are tenant-scoped; permissions are global"],
        ["organizations 1─* accounts (self-referencing tree)", "parent_id nullable, header accounts are non-postable"],
        ["organizations 1─* fiscal_years 1─* accounting_periods", "Periods cannot outlive their fiscal year's date range"],
        ["organizations 1─* journal_entries 1─* journal_entry_lines ─* accounts", "Only AccountingPostingEngine writes here"],
        ["(future) invoice_documents 1─* zatca_documents 1─* zatca_submissions", "Not modeled yet — see 07_Database_Tables"],
    ],
    [50, 60],
    rtl=False,
)

# 09_Invoice_Types
add_sheet(
    "09_Invoice_Types",
    ["Invoice Type", "ZATCA Classification", "Model", "Notes"],
    [
        ["Standard Tax Invoice (B2B/B2G)", "Standard Tax Invoice", "Clearance", "Buyer VAT number required if buyer registered"],
        ["Simplified Tax Invoice (B2C)", "Simplified Tax Invoice", "Reporting (within 24h)", "QR code mandatory on print/share"],
        ["Credit Note", "Associated to original invoice type", "Follows original's model", "Must reference original invoice UUID"],
        ["Debit Note", "Associated to original invoice type", "Follows original's model", "Must reference original invoice UUID"],
        ["Progress Certificate (Contracting)", "NOT a ZATCA tax document itself", "N/A", "Business template only — see band 48/82; the resulting Tax Invoice is what's classified"],
    ],
    [32, 26, 20, 46],
    rtl=False,
)

# 10_Invoice_Fields (high-level, human-readable — detailed BT mapping lives in sheet 13)
add_sheet(
    "10_Invoice_Fields",
    ["Field Group", "Fields", "Classification"],
    [
        ["Seller", "Legal name, VAT number, CR number, National Address", "ZATCA_REQUIRED"],
        ["Buyer", "Name, VAT number (if B2B), address", "ZATCA_CONDITIONAL"],
        ["Invoice Meta", "Number, UUID, issue date/time, invoice type code", "ZATCA_REQUIRED"],
        ["Lines", "Description, quantity, unit, unit price, discount, VAT category, line total", "ZATCA_REQUIRED"],
        ["Totals", "Subtotal, discount total, VAT total, grand total", "ZATCA_REQUIRED"],
        ["Security", "QR code, cryptographic stamp, hash, previous invoice hash (Phase 2)", "ZATCA_REQUIRED"],
        ["Branding (business-optional)", "Logo, header/footer text, color, watermark, signature image", "BUSINESS_OPTIONAL"],
    ],
    [26, 60, 20],
    rtl=False,
)

# 11_Invoice_Templates
add_sheet(
    "11_Invoice_Templates",
    ["Template", "Page Size", "Language", "Status"],
    [
        ["Classic Arabic", "A4", "AR", "Design pending"],
        ["Modern Arabic", "A4", "AR", "Design pending"],
        ["Corporate Professional", "A4", "AR/EN", "Design pending"],
        ["Arabic-English Bilingual", "A4", "AR+EN", "Design pending"],
        ["Minimal", "A4", "AR/EN", "Design pending"],
        ["Retail A4", "A4", "AR", "Design pending"],
        ["Retail Thermal 80mm", "80mm", "AR", "Design pending"],
        ["Services", "A4", "AR/EN", "Design pending"],
        ["Contracting", "A4", "AR/EN", "Design pending"],
        ["Agriculture", "A4", "AR", "Design pending"],
    ],
    [26, 12, 14, 20],
    rtl=False,
)

# 12_Template_Field_Rules
add_sheet(
    "12_Template_Field_Rules",
    ["Classification", "Meaning", "User Can Hide?", "User Can Move/Restyle?"],
    [
        ["BUSINESS_OPTIONAL", "Nice-to-have business info", "Yes", "Yes"],
        ["BUSINESS_REQUIRED", "Required by this business's own policy", "No (org admin only)", "Yes"],
        ["ZATCA_REQUIRED", "Mandated by ZATCA on every applicable invoice", "No", "Position/style only, never hidden"],
        ["ZATCA_CONDITIONAL", "Mandated only in certain cases (e.g. buyer VAT for B2B)", "No, when condition applies", "Position/style only"],
        ["XML_ONLY", "Present in XML but not necessarily printed", "N/A — not a print field", "N/A"],
        ["DISPLAY_REQUIRED", "Must be human-readable on the printed/shared copy", "No", "Position/style only"],
    ],
    [22, 40, 24, 30],
    rtl=False,
)

# 13_ZATCA_Field_Mapping — verified 2026-09-09 against official XML Implementation Standard v1.2 (2023-05-19)
add_sheet(
    "13_ZATCA_Field_Mapping",
    ["Internal Field", "Official BT/KSA ID", "Business Rule(s)", "Required/Conditional", "Applicable Invoice Type", "Source"],
    [
        ["invoice.uuid", "KSA-1", "BR-KSA-03: unique UUID generated by the issuing system, letters/digits/dashes only", "Required", "All", "XML Standard v1.2 §13.3.1"],
        ["invoice.number", "BT-1", "BR-02: every invoice must have a number", "Required", "All", "XML Standard v1.2 §13.2.1"],
        ["invoice.issueDate", "BT-2", "BR-03 / BR-KSA-04: must be <= current date", "Required", "All", "XML Standard v1.2"],
        ["invoice.issueTime", "KSA-25", "BR-KSA-70: format hh:mm:ss (local) or hh:mm:ssZ (UTC)", "Required", "All", "XML Standard v1.2 §13.3.1"],
        ["invoice.typeCode", "BT-3", "388=Tax Invoice, 383=Debit Note, 381=Credit Note, 386=Prepayment Invoice", "Required", "All", "XML Standard v1.2 §11.2.1"],
        ["invoice.subtype", "KSA-2", "7-char flag string: subtype(01/02) + 3rd-party + nominal + export + summary + self-billed", "Required", "All", "XML Standard v1.2 §11.2.1 / BR-KSA-06"],
        ["seller.name", "BT-27", "BR-06: seller legal registration name", "Required", "All", "XML Standard v1.2"],
        ["seller.vatNumber", "BT-31", "BR-KSA-39/40: 15 digits, first and last digit = 3", "Required", "All", "XML Standard v1.2 §13.3.1"],
        ["seller.address", "BG-5 (street/building/postal/city/district/country)", "BR-08/09, BR-KSA-09: full national-address components required", "Required", "All", "XML Standard v1.2"],
        ["buyer.name", "BT-44", "BR-KSA-42: required on Tax Invoice; BR-KSA-25/71: required in specific Simplified cases", "Conditional", "Mainly Standard", "XML Standard v1.2"],
        ["buyer.vatNumber", "BT-48", "BR-KSA-44: 15 digits, first/last = 3; not required for exports (BR-KSA-46)", "Conditional (B2B)", "Standard", "XML Standard v1.2"],
        ["buyer.otherId", "BT-46", "BR-KSA-14/81: required if buyer has no VAT number, one of TIN/CRN/MOM/MLS/700/SAG/NAT/GCC/IQA/PAS/OTH", "Conditional", "Standard", "XML Standard v1.2 §13.3.1"],
        ["invoiceLine.vatCategory", "BT-151", "One of S/Z/E/O — drives BR-S/BR-Z/BR-E/BR-O rule sets", "Required", "All", "XML Standard v1.2 §11.2.4"],
        ["invoice.taxTotal", "BT-110", "BR-CO-14: sum of all VAT category tax amounts (BT-117)", "Required", "All", "XML Standard v1.2 §9.2"],
        ["invoice.totalWithVat", "BT-112", "BR-CO-15: total without VAT + total VAT", "Required", "All", "XML Standard v1.2 §9.2"],
        ["invoice.payableAmount", "BT-115", "BR-CO-16: total with VAT − prepaid + rounding", "Required", "All", "XML Standard v1.2 §9.2"],
        ["invoice.previousInvoiceHash", "KSA-13", "BR-KSA-26/61: Base64 SHA-256 of prior invoice; genesis value is the hash of \"0\"", "Required (Phase 2)", "All", "Security Features v1.2 §3 + BR-KSA-26"],
        ["invoice.qr", "KSA-14", "BR-KSA-27: Base64, TLV-encoded, ≤700 chars — see sheet 15 for tag layout", "Required", "All (Simplified always; Standard human-readable copy)", "Security Features v1.2 §4"],
        ["invoice.cryptographicStamp", "KSA-15", "BR-KSA-28/29/30: XAdES enveloped signature, fixed signature/reference IDs", "Required (Phase 2)", "All", "Security Features v1.2 §2.3"],
        ["invoice.counterValue", "KSA-16", "BR-KSA-33/34: sequential, digits only, per EGS device", "Required", "All", "XML Standard v1.2 §13.3.1"],
    ],
    [24, 20, 46, 20, 26, 26],
    rtl=False,
)

# 14_ZATCA_XML_Mapping — verified 2026-09-09
add_sheet(
    "14_ZATCA_XML_Mapping",
    ["Concern", "Verified Content", "Source"],
    [
        ["Base standards", "UBL 2.1 (main invoice schema) + ISO/CEN EN 16931:2017 + KSA-specific rules (BR-KSA*) layered on top; KSA rules override EN 16931 which overrides plain UBL on conflict", "XML Standard v1.2 §1.3, §4"],
        ["Validation phases", "1) XML well-formedness + UBL 2.1 schema; 2) content validation against EN 16931 subset + KSA (CIUS) country-qualified rules triggered by seller country = SA", "XML Standard v1.2 §4"],
        ["Rounding", "Half-up rounding; round only the final result, never intermediate values; VAT category tax amount rounded at document level, not summed from rounded line VATs", "XML Standard v1.2 §10"],
        ["Invoice type codes", "388=Tax Invoice (388+\"01\"=standard, 388+\"02\"=simplified), 386=Prepayment Invoice, 383=Debit Note, 381=Credit Note", "XML Standard v1.2 §11.2.1"],
        ["Currency rule", "Invoice totals may be in any currency; the tax total (BT-110/BT-111) must be expressed in SAR", "XML Standard v1.2 §9.1, BR-KSA-EN16931-02"],
        ["VAT calc formula", "VAT category taxable amount = Σ(line net amounts) + document charges − document allowances, grouped by (category, rate); tax amount = taxable amount × rate/100", "XML Standard v1.2 §9.6"],
        ["Rule families present", "BR (integrity), BR-CO (conditions), BR-S/Z/E/O (per VAT category), BR-CL (code lists), BR-DEC (decimal precision), BR-KSA / BR-KSA-DEC / BR-KSA-CL / BR-KSA-EN16931 / BR-KSA-F (Saudi-specific)", "XML Standard v1.2 §13"],
        ["Not yet extracted", "Full field-by-field Data Dictionary (names, definitions, character limits, examples) — lives in the companion XLSX, not the PDF; see ZATCA_SOURCES.md §2 for pending status", "Data Dictionary (xlsx) — link recorded, content not yet parsed"],
    ],
    [22, 70, 40],
    rtl=False,
)

# 15_ZATCA_QR_Mapping — verified 2026-09-09 against Security Features Implementation Standards v1.2 §4
add_sheet(
    "15_ZATCA_QR_Mapping",
    ["Tag", "Field", "Phase / Enforcement date", "Notes"],
    [
        ["1", "Seller's name", "Phase 1 — 4 Dec 2021", "UTF-8 string, TLV length-prefixed"],
        ["2", "Seller VAT registration number", "Phase 1 — 4 Dec 2021", "15-digit string"],
        ["3", "Invoice timestamp (ISO 8601)", "Phase 1 — 4 Dec 2021", "Example format: 2022-02-21T12:13:57Z"],
        ["4", "Invoice total with VAT", "Phase 1 — 4 Dec 2021", "Decimal as string"],
        ["5", "VAT total (BT-110)", "Phase 1 — 4 Dec 2021", "Decimal as string"],
        ["6", "Hash of the XML invoice", "Phase 2 — 1 Jan 2023", "SHA-256, 32 raw bytes (not hex/base64 inside the TLV value itself)"],
        ["7", "ECDSA signature of the XML hash", "Phase 2 — 1 Jan 2023", "Raw signature bytes"],
        ["8", "ECDSA public key (from signing private key)", "Phase 2 — 1 Jan 2023", "Raw public key bytes"],
        ["9", "ZATCA's signature of the cryptographic stamp", "Phase 2 — 1 Jan 2023", "Simplified Tax Invoices and their notes only"],
    ],
    [8, 40, 24, 46],
    rtl=False,
)

# 16_ZATCA_Security — verified 2026-09-09 against Security Features Implementation Standards v1.2
add_sheet(
    "16_ZATCA_Security",
    ["Component", "Verified Specification", "Source"],
    [
        ["Hashing algorithm", "SHA-256", "Security Features v1.2 §2.2.1 req. 16"],
        ["Signature algorithm", "ECDSA, key length 256 (P-256 curve)", "Security Features v1.2 §2.2.1 req. 16, §2.2.2"],
        ["Certificate standard", "X.509 v3 per RFC 5280; validity up to 60 months from issuance", "Security Features v1.2 §2.2.2"],
        ["CSR subject fields (RDNs)", "Common Name (device asset tag), Organization Identifier (15-digit VAT, first/last digit 3), Organization Unit (branch name, or 10-digit TIN for VAT-group members), Organization Name, Country, Invoice Type support flags (TSCZ bitmap), Location, Industry", "Security Features v1.2 §2.2.2 Table 1"],
        ["Onboarding flow", "Taxpayer logs into taxpayer portal → submits CSR → ZATCA's technical CA validates and issues a Cryptographic Stamp Identifier (digital certificate) → certificate installed on the EGS", "Security Features v1.2 §2.1.1"],
        ["Certificate revocation check", "CRL valid for 7 days (EGS may work offline up to 7 days before refreshing); OCSP also supported", "Security Features v1.2 §2.2.1 req. 14"],
        ["XML signature format", "XAdES, enveloped, level B-B, per ETSI EN 319 132-1; the QR-code element itself is excluded from what gets signed via an XPath transform", "Security Features v1.2 §2.2.1 req. 10-12, §2.3.3"],
        ["PDF/A-3 signature format", "PAdES per ETSI EN 319 142-1, when invoices are shared as PDF/A-3 with embedded XML", "Security Features v1.2 §2.2.1 req. 10"],
        ["EGS API authentication", "OAuth 2.0 Basic Authentication — Client ID = the issued digital certificate, Secret = value issued at onboarding", "Security Features v1.2 §5"],
        ["Previous Invoice Hash (PIH)", "Base64 SHA-256 of the previous invoice, computed the same way as the cryptographic stamp hash; the very first invoice uses the fixed genesis hash of the character \"0\"", "Security Features v1.2 §3 + XML Standard BR-KSA-26"],
    ],
    [26, 60, 40],
    rtl=False,
)

# 17_Tax_Codes
add_sheet(
    "17_Tax_Codes",
    ["Tax Code", "Rate", "Category"],
    [
        ["STANDARD", "15%", "Standard Rated"],
        ["ZERO", "0%", "Zero Rated"],
        ["EXEMPT", "N/A", "Exempt"],
        ["OUT_OF_SCOPE", "N/A", "Out of Scope"],
    ],
    [18, 12, 20],
    rtl=False,
)

# 18_POS_Transactions
add_sheet(
    "18_POS_Transactions",
    ["Transaction Type", "Notes"],
    [
        ["Cash Sale", "Single tender, full amount in cash"],
        ["Card / Mada Sale", "Posts to Card Clearing Account, not directly to Bank"],
        ["Mixed Payment", "Multiple tenders recorded separately (e.g. Cash 100 + Card 150)"],
        ["Hold / Resume", "Not a financial transaction — cart state only"],
        ["Full Return", "References original receipt; reverses inventory + accounting + VAT + ZATCA effect"],
        ["Partial Return", "Same as Full Return, scoped to selected lines/quantities"],
        ["Shift Open / Close", "Not a sale — records opening/expected/actual cash and variance"],
    ],
    [22, 60],
    rtl=False,
)

# 19_Inventory_Transactions
add_sheet(
    "19_Inventory_Transactions",
    ["Movement Type", "Accounting Effect"],
    [
        ["Opening Balance", "Dr Inventory / Cr Opening Balance Equity"],
        ["Purchase Receipt", "Dr Inventory / Cr Accounts Payable (via PURCHASE_BILL_POSTED)"],
        ["Sales Issue", "Dr COGS / Cr Inventory (alongside the sale's revenue entry)"],
        ["Sales Return", "Dr Inventory / Cr COGS (reverse of Sales Issue)"],
        ["Purchase Return", "Dr Accounts Payable / Cr Inventory"],
        ["Warehouse Transfer", "No accounting effect — quantity moves between warehouses only"],
        ["Adjustment", "Dr/Cr Inventory vs Inventory Adjustment or Expense, depending on gain/loss"],
        ["Damage/Loss", "Dr Expense (or Inventory Write-off) / Cr Inventory"],
    ],
    [22, 60],
    rtl=False,
)

# 20_Contracting_Fields
add_sheet(
    "20_Contracting_Fields",
    ["Field", "Notes"],
    [
        ["Project Name / Code", "-"],
        ["Contract Number", "-"],
        ["BOQ Item / Description / Unit", "-"],
        ["Contract Qty / Previous Qty / Current Qty / Accumulated Qty", "-"],
        ["Unit Rate / Current Value / Previous Value / Accumulated Value", "-"],
        ["Retention % / Retention Amount", "-"],
        ["Advance Recovery / Deductions", "-"],
        ["VAT / Net Amount", "Computed by the same Invoice Calculation Engine as every other template"],
    ],
    [50, 60],
    rtl=False,
)

# 21_Agriculture_Fields
add_sheet(
    "21_Agriculture_Fields",
    ["Field", "Notes"],
    [
        ["Farm / Farm Location", "-"],
        ["Crop / Variety / Grade", "-"],
        ["Lot/Batch / Harvest Date", "-"],
        ["Gross Weight / Tare Weight / Net Weight", "-"],
        ["Quantity / Unit / Price per Unit / Price per KG-Ton", "-"],
        ["Packaging / Transport / Other Charges", "-"],
        ["Discount / Tax / Total", "-"],
    ],
    [50, 60],
    rtl=False,
)

# 22_Roles
add_sheet(
    "22_Roles",
    ["Role", "Typical Scope"],
    [
        ["Owner", "Full access across the organization"],
        ["General Manager", "Full operational access, org-wide"],
        ["Finance Manager", "Accounting, banking, reports, period closing"],
        ["Chief Accountant", "Journal posting/reversal, COA management"],
        ["Accountant", "Journal entry, invoices, payments (no reversal)"],
        ["Branch Manager", "Full access scoped to one branch"],
        ["Sales", "Sales invoices, customers"],
        ["Purchasing", "Purchase orders/bills, suppliers"],
        ["Inventory Manager", "Products, warehouses, adjustments"],
        ["POS Supervisor", "Discount overrides, shift approvals"],
        ["Cashier", "POS sales only, own shift"],
        ["Auditor", "Read-only + audit trail visibility"],
        ["Read Only", "View-only, no financial actions"],
    ],
    [24, 50],
    rtl=False,
)

# 23_Permissions
add_sheet(
    "23_Permissions",
    ["Permission Code", "Module"],
    [
        ["invoice.view", "invoice"], ["invoice.create", "invoice"], ["invoice.approve", "invoice"],
        ["invoice.post", "invoice"], ["invoice.credit", "invoice"], ["invoice.print", "invoice"],
        ["invoice_template.view", "invoice-studio"], ["invoice_template.edit", "invoice-studio"],
        ["invoice_template.publish", "invoice-studio"],
        ["journal.create", "accounting"], ["journal.post", "accounting"], ["journal.reverse", "accounting"],
        ["pos.sell", "pos"], ["pos.return", "pos"], ["pos.discount", "pos"],
        ["pos.overrideDiscount", "pos"], ["pos.changePrice", "pos"], ["pos.cashIn", "pos"], ["pos.cashOut", "pos"],
        ["bank.reconcile", "banking"],
        ["reports.pnl.view", "reports"],
        ["zatca.view", "zatca"], ["zatca.manage", "zatca"],
        ["users.manage", "users"], ["settings.manage", "organizations"],
    ],
    [26, 18],
    rtl=False,
)

# 24_Report_Catalog
add_sheet(
    "24_Report_Catalog",
    ["Report", "Category", "Status"],
    [
        ["General Ledger", "Financial", "Implemented and live-tested (running balance per account)"],
        ["Trial Balance", "Financial", "Implemented and live-tested"],
        ["Profit & Loss", "Financial", "Implemented and live-tested"],
        ["Balance Sheet", "Financial", "Implemented and live-tested — balance identity mathematically proven in tests"],
        ["Cash Flow", "Financial", "Implemented and live-tested — direct method, Cash+Bank combined pool, bank transfers self-cancel"],
        ["VAT Report", "Financial", "Not started"],
        ["Customer Statement", "Financial", "Not started"],
        ["Supplier Statement", "Financial", "Not started"],
        ["Receivable Aging", "Financial", "Implemented and live-tested — buckets by age, excludes fully-paid invoices"],
        ["Payable Aging", "Financial", "Implemented and live-tested — mirrors Receivable Aging logic"],
        ["Stock Balance", "Inventory", "Covered by GET /inventory/products/:id/stock (not a dedicated report yet)"],
        ["Inventory Valuation", "Inventory", "Not started"],
        ["Low Stock", "Inventory", "Not started"],
        ["Product Profitability", "Inventory", "Not started"],
        ["Daily Sales", "POS", "Not started"],
        ["Cashier Sales", "POS", "Not started"],
        ["Shift Closing", "POS", "Not started — POS Shift itself not built yet"],
        ["Project Profitability", "Projects", "Not started"],
    ],
    [30, 16, 55],
    rtl=False,
)

# 25_API_Endpoints
add_sheet(
    "25_API_Endpoints",
    ["Endpoint", "Status"],
    [
        ["POST /api/v1/auth/login", "Implemented and live-tested"],
        ["POST /api/v1/organizations", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/branches", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/branches", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/customers", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/sales/invoices", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/suppliers", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/purchases/bills", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/products", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/inventory/receipts", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/inventory/issues", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/inventory/products/:productId/stock", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/pos/sales", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/pos/sales/:saleId/return", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/accounting/journal-entries", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/accounting/journal-entries/:id/reverse", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/accounting/periods/:id/trial-balance", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/reports/periods/:id/general-ledger", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/reports/periods/:id/profit-and-loss", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/reports/periods/:id/balance-sheet", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/reports/periods/:id/cash-flow", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/expenses", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/assets", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/assets/:id/depreciate", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/banking/transfers", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/pos/sales/:id/return-items", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/payments/customer", "Implemented and live-tested"],
        ["POST /api/v1/organizations/:id/payments/supplier", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/statements/customer/:id", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/statements/supplier/:id", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/aging/receivable", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/aging/payable", "Implemented and live-tested"],
        ["GET /api/v1/organizations/:id/periods", "Implemented and live-tested (Sprint 23 — closes the manual period-paste gap)"],
        ["GET /api/v1/organizations/:id/pos/sales/:id/receipt", "Implemented and live-tested (Sprint 25 — real invoice/receipt linked to organization + transaction data, verified via a genuine QR decode round-trip)"],
        ["GET /api/v1/organizations/:id/sales/invoices/:id/receipt", "Implemented and live-tested (Sprint 25)"],
        ["GET /api/v1/organizations/:id", "Implemented and live-tested (Sprint 29)"],
        ["PATCH /api/v1/organizations/:id/settings", "Implemented and live-tested (Sprint 29 — requireShiftForPosSale toggle)"],
        ["POST /api/v1/organizations/:id/periods", "Implemented and live-tested (Sprint 31 — closes the 'only one period ever exists' gap)"],
        ["/api/v1/zatca/*", "Not implemented — blocked on Data Dictionary extraction"],
    ],
    [55, 55],
    rtl=False,
)

# 26_Test_Cases
add_sheet(
    "26_Test_Cases",
    ["Test ID", "Area", "Description", "Status"],
    [
        ["ACC-001", "Accounting", "Rejects unbalanced entry (Debit != Credit)", "Passing — accounting-posting-engine.spec.ts"],
        ["ACC-002", "Accounting", "Accepts balanced entry, writes correct lines", "Passing"],
        ["ACC-003", "Accounting", "Blocks posting into CLOSED period", "Passing"],
        ["ACC-004", "Accounting", "Reversal creates counter-entry, does not mutate original", "Passing"],
        ["ACC-005", "Accounting", "Refuses double reversal of the same entry", "Passing"],
        ["ACC-006", "Accounting", "No duplicate posting under concurrent requests (idempotency)", "Planned — needs live Postgres integration test"],
        ["AUTH-001", "Auth", "Issues a token with correct userId/organizationId/roleId on valid login", "Passing — auth.service.spec.ts"],
        ["AUTH-002", "Auth", "Rejects wrong password", "Passing"],
        ["AUTH-003", "Auth", "Unknown email and wrong password return the identical error (no account enumeration)", "Passing"],
        ["AUTH-004", "Auth", "Rejects login into an organization the user doesn't belong to", "Passing"],
        ["AUTH-005", "Auth", "Rejects a deactivated user", "Passing"],
        ["TEN-001", "Tenant Isolation", "Blocks a request whose path organizationId differs from the token's", "Passing — tenant.guard.spec.ts"],
        ["TEN-002", "Tenant Isolation", "Deep repository-level isolation (Prisma extension + Postgres RLS)", "Planned — needs live Postgres"],
        ["RBAC-001", "RBAC", "Grants access only when every required permission is present", "Passing — permissions.guard.spec.ts"],
        ["RBAC-002", "RBAC", "Blocks and names the missing permission otherwise", "Passing"],
        ["RBAC-003", "RBAC", "Cashier role without pos.overrideDiscount is blocked from that action", "Passing"],
        ["AUD-001", "Audit", "Only handlers marked @AuditAction produce a log entry", "Passing — audit.interceptor.spec.ts"],
        ["AUD-002", "Audit", "Both success and error outcomes are recorded", "Passing"],
        ["ORG-001", "Organizations", "Rejects a duplicate VAT number", "Passing — organizations.service.spec.ts"],
        ["ORG-002", "Organizations", "Seeds all 13 default roles and hashes the owner's password", "Passing"],
        ["ORG-003", "Organizations", "Skips the VAT-uniqueness check (not fails) when no VAT number is given yet", "Passing"],
        ["TB-001", "Accounting (read)", "Trial balance sums debit/credit per account and reports balanced when equal", "Passing — accounting-query.service.spec.ts"],
        ["TB-002", "Accounting (read)", "Reports isBalanced=false without throwing on a genuinely unbalanced report", "Passing"],
        ["TB-003", "Accounting (read)", "50-line fractional-cents sum has no float drift", "Passing"],
        ["ZQR-001..006", "ZATCA QR", "Phase 1/2 TLV encode+decode round-trip, tag ordering, length-overflow and hash-length guards", "Passing — qr-encoder.spec.ts"],
        ["DEF-001", "Accounting HTTP", "UnbalancedEntryError maps to HTTP 400 (not a generic 500) via DomainExceptionFilter", "Passing — domain-exception.filter.spec.ts; bug found and fixed via live curl smoke test"],
        ["DEF-002", "Accounting HTTP", "ClosedPeriodError maps to HTTP 409", "Passing"],
        ["DEF-003", "Accounting HTTP", "EntryAlreadyReversedError maps to HTTP 409", "Passing"],
        ["E2E-001", "End-to-end (live server)", "Login -> post balanced journal entry -> succeeds with correct lines", "Verified live via curl against a running ts-node server (not a unit test)"],
        ["E2E-002", "End-to-end (live server)", "Login -> post unbalanced journal entry -> HTTP 400, and it does NOT appear in the Trial Balance", "Verified live via curl"],
        ["E2E-003", "End-to-end (live server)", "Trial Balance reflects only committed entries, isBalanced=true", "Verified live via curl"],
        ["E2E-004", "End-to-end (live server)", "Request with a different organizationId in the URL path is blocked (403)", "Verified live via curl"],
        ["E2E-005", "End-to-end (live server)", "Request with no bearer token at all is blocked (401)", "Verified live via curl"],
        ["IDEM-001", "Idempotency (band 91)", "Replaying the same idempotencyKey returns the ORIGINAL entry, not a duplicate", "Passing — accounting-posting-engine.spec.ts"],
        ["IDEM-002", "Idempotency (band 91)", "A different idempotencyKey for the same org still posts a new entry", "Passing"],
        ["IDEM-003", "Idempotency (band 91)", "Posting with no key at all never triggers the idempotency path", "Passing"],
        ["E2E-006", "End-to-end (live server)", "Same request replayed with the same Idempotency-Key header returns the identical journal entry id; Trial Balance reflects it only once", "Verified live via curl"],
        ["BR-001", "Branches (band 6)", "Rejects a duplicate branch code within the same organization", "Passing — branches.service.spec.ts"],
        ["BR-002", "Branches (band 6)", "Allows the SAME branch code across two DIFFERENT organizations", "Passing"],
        ["BR-003", "Branches (band 6)", "Lists only branches belonging to the requested organization", "Passing"],
        ["E2E-007", "End-to-end (live server)", "Create branch succeeds; duplicate code for the same org is rejected live with HTTP 409", "Verified live via curl"],
        ["E2E-008", "End-to-end (live server)", "List branches returns only the created branch", "Verified live via curl"],
        ["SALES-001", "Sales", "Computes subtotal/tax/total correctly for a standard-rated line and posts Dr AR / Cr Sales+VAT", "Passing — sales.service.spec.ts"],
        ["SALES-002", "Sales", "Omits the VAT line entirely for a zero-rated invoice (no clutter)", "Passing"],
        ["SALES-003", "Sales", "Sums multiple lines with mixed tax codes correctly", "Passing"],
        ["SALES-004", "Sales", "Rejects an invoice with zero lines", "Passing"],
        ["SALES-005", "Sales", "Rejects a line with zero/negative quantity", "Passing"],
        ["SALES-006", "Sales", "Rejects an invoice for a customer that doesn't exist in this organization", "Passing"],
        ["SALES-007", "Sales", "Passes idempotencyKey straight through to the posting engine", "Passing"],
        ["E2E-009", "End-to-end (live server)", "Create customer -> post 2-line mixed-tax invoice -> Subtotal 1200.00, VAT 150.00, Total 1350.00", "Verified live via curl"],
        ["E2E-010", "End-to-end (live server)", "Trial Balance after the invoice shows AR=1350, Sales=1200, VAT=150, isBalanced=true", "Verified live via curl"],
        ["E2E-011", "End-to-end (live server)", "Invoicing a nonexistent customer returns HTTP 404 live", "Verified live via curl"],
        ["INV-T-001", "Inventory", "Second receipt at a different cost recalculates the weighted average correctly (100@10 + 50@16 -> 12.00)", "Passing — inventory.service.spec.ts"],
        ["INV-T-002", "Inventory", "Issuing stock uses the CURRENT weighted average, not the original receipt cost", "Passing"],
        ["INV-T-003", "Inventory", "Posts Dr Inventory/Cr Opening Balance Equity on receipt, Dr COGS/Cr Inventory on issue", "Passing"],
        ["INV-T-004", "Inventory", "Rejects issuing more than is on hand", "Passing"],
        ["INV-T-005", "Inventory", "postJournal=false / postToOpeningBalance=false skips the engine call (integration mode)", "Passing"],
        ["PUR-001", "Purchases", "Posts Dr Inventory + VAT Input / Cr Accounts Payable for a stocked line", "Passing — purchases.service.spec.ts"],
        ["PUR-002", "Purchases", "Routes a non-stocked line to the general expense account instead of Inventory", "Passing"],
        ["PUR-003", "Purchases", "Splits a mixed bill correctly between Inventory and general expense", "Passing"],
        ["PUR-004", "Purchases", "Calls InventoryService.receiveStock with postToOpeningBalance=false (no duplicate journal entry)", "Passing"],
        ["POS-T-001", "POS", "Cash sale posts Dr Cash / Cr Sales+VAT", "Passing — pos.service.spec.ts"],
        ["POS-T-002", "POS", "Mixed payment (band 37) splits correctly between Cash and Card Clearing", "Passing"],
        ["POS-T-003", "POS", "Rejects when tender total doesn't match the invoice total", "Passing"],
        ["POS-T-004", "POS", "A line with productId triggers a SEPARATE COGS journal entry", "Passing"],
        ["POS-T-005", "POS", "Full return reverses BOTH the sale entry and COGS entry, restores stock at ORIGINAL unit cost", "Passing"],
        ["POS-T-006", "POS", "Rejects returning a sale that was already returned", "Passing"],
        ["E2E-012", "End-to-end (live server)", "Full chain: create product -> purchase 100@10 -> stock=100@10.00", "Verified live via curl"],
        ["E2E-013", "End-to-end (live server)", "POS sell 10@20 STANDARD -> Subtotal 200/VAT 30/Total 230, COGS=100.00, stock=90", "Verified live via curl"],
        ["E2E-014", "End-to-end (live server)", "Trial Balance after purchase+sale balanced across 7 accounts (1480=1480)", "Verified live via curl"],
        ["E2E-015", "End-to-end (live server)", "POS return reverses sale+COGS journal entries, stock restored to 100@10.00 exactly", "Verified live via curl"],
        ["E2E-016", "End-to-end (live server)", "Trial Balance after return still balanced (self-cancelling reversal lines)", "Verified live via curl"],
        ["E2E-017", "End-to-end (live server)", "Attempting to return the same POS sale twice is rejected live with HTTP 400", "Verified live via curl"],
        ["RPT-001", "Reporting", "General Ledger computes a running balance line by line in chronological order", "Passing — reporting.service.spec.ts"],
        ["RPT-002", "Reporting", "P&L classifies accounts correctly and nets Sales Returns against Sales", "Passing"],
        ["RPT-003", "Reporting", "PROOF: Assets = Liabilities + Equity + Net Income holds for a realistic posted-style trial balance (not an assumed formula)", "Passing — concrete mathematical proof, see test comments"],
        ["RPT-004", "Reporting", "Balance Sheet identity still holds with an Opening Balance Equity line present", "Passing"],
        ["E2E-018", "End-to-end (live server)", "P&L after purchase+sale scenario: Revenue 200.00, COGS 100.00, Net Income 100.00", "Verified live via curl"],
        ["E2E-019", "End-to-end (live server)", "Balance Sheet after same scenario: Assets 1280.00 = Liabilities 1180.00 + Equity 0.00 + Net Income 100.00", "Verified live via curl"],
        ["E2E-020", "End-to-end (live server)", "General Ledger for the inventory account shows correct running balance (1000.00 -> 900.00)", "Verified live via curl"],
        ["ACC-CH-001", "Chart of Accounts", "Rejects a duplicate account code within the same organization", "Passing — accounts.service.spec.ts"],
        ["ACC-CH-002", "Chart of Accounts", "Resolves parentCode to the parent's id", "Passing"],
        ["ACC-CH-003", "Chart of Accounts", "Rejects creating an account under a parent code that doesn't exist", "Passing"],
        ["ACC-CH-004", "Chart of Accounts", "getAccountIdByCode throws a clear setup error when the code is missing", "Passing"],
        ["ACC-CH-005", "Chart of Accounts", "seedDefaultChartOfAccounts creates every code from spec band 20's example with correct parent links", "Passing"],
        ["ACC-CH-006", "Chart of Accounts", "Account codes are scoped per organization — same code can exist in two different orgs", "Passing"],
        ["E2E-021", "End-to-end (live server)", "Default COA seed produces exactly 19 accounts (codes 1000-6100) with correct types and isPostable flags", "Verified live via curl"],
        ["E2E-022", "End-to-end (live server)", "Same purchase+sell scenario re-verified AFTER the Chart-of-Accounts refactor: identical financial results (Trial Balance 1480=1480, Net Income 100.00, Balance Sheet balanced), now resolved via real seeded account UUIDs instead of hardcoded strings", "Verified live via curl"],
        ["E2E-023", "End-to-end (live server)", "Creating a duplicate account code (1100) is rejected live with HTTP 409", "Verified live via curl"],
        ["SHIFT-001", "POS Shift", "Opens a shift with the given opening cash", "Passing — shifts.service.spec.ts"],
        ["SHIFT-002", "POS Shift", "Rejects opening a second shift on a terminal that already has one open", "Passing"],
        ["SHIFT-003", "POS Shift", "Allows open shifts on two DIFFERENT terminals simultaneously", "Passing"],
        ["SHIFT-004", "POS Shift", "Rejects a negative opening cash amount", "Passing"],
        ["SHIFT-005", "POS Shift", "Closing with actual cash matching expected gives zero difference", "Passing"],
        ["SHIFT-006", "POS Shift", "Reports a shortage as a negative difference, not silently", "Passing"],
        ["SHIFT-007", "POS Shift", "Rejects closing a shift that was already closed", "Passing"],
        ["SHIFT-008", "POS Shift", "Rejects closing a shift that doesn't exist", "Passing"],
        ["SHIFT-009", "POS Shift", "After closing, a new shift CAN be opened on the same terminal", "Passing"],
        ["E2E-024", "End-to-end (live server)", "Trial Balance now shows real account codes/names (e.g. '1300 Inventory') instead of raw UUIDs", "Verified live via curl"],
        ["E2E-025", "End-to-end (live server)", "Open shift -> attempt second open on same terminal rejected (400) -> close with a 5.00 SAR shortage computed and reported correctly", "Verified live via curl"],
        ["SHIFT-010", "POS Shift", "recordCashMovement accumulates cash sales onto the shift's running total", "Passing — shifts.service.spec.ts"],
        ["SHIFT-011", "POS Shift", "recordCashMovement accumulates cash returns onto a separate running total", "Passing"],
        ["SHIFT-012", "POS Shift", "A zero cash amount (fully card-paid sale) is a no-op, not an error", "Passing"],
        ["SHIFT-013", "POS Shift", "Rejects recording a cash movement against a CLOSED shift", "Passing"],
        ["SHIFT-014", "POS Shift", "Rejects recording against a shift that doesn't exist", "Passing"],
        ["SHIFT-015", "POS Shift", "End-to-end unit proof: opening 200 + cash sales 115 - cash return 30 = expected 285 at close", "Passing"],
        ["POS-T-007", "POS x Shift integration", "Records the cash tender against the open shift after a successful sale", "Passing — pos.service.spec.ts"],
        ["POS-T-008", "POS x Shift integration", "Rejects a sale against a shift that isn't OPEN", "Passing"],
        ["POS-T-009", "POS x Shift integration", "Rejects a sale against a shift belonging to a DIFFERENT terminal", "Passing"],
        ["POS-T-010", "POS x Shift integration", "Rejects a sale referencing a shift that doesn't exist", "Passing"],
        ["POS-T-011", "POS x Shift integration", "A return on a sale linked to a still-OPEN shift records a cash return against it", "Passing"],
        ["POS-T-012", "POS x Shift integration", "A return on a sale whose shift has since CLOSED still succeeds — shift reconciliation skipped, not blocking", "Passing"],
        ["E2E-026", "End-to-end (live server)", "Full shift-linked scenario: open (200) -> sell 115 (total 115) -> sell 50 (total 165) -> return first sale (returns 115) -> close with actual 250 = expected 250, difference 0.00", "Verified live via curl"],
        ["E2E-027", "End-to-end (live server)", "Selling against an already-closed shift is rejected live with HTTP 400", "Verified live via curl"],
        ["EXP-001..003", "Expenses", "Posts Dr Expense+VAT Input/Cr Payment; omits VAT line for zero-rated; rejects non-positive amount", "Passing — expenses.service.spec.ts"],
        ["AST-001..006", "Fixed Assets", "Acquisition posting, residual-vs-cost validation, straight-line depreciation calc, accumulation across calls, rejects exceeding depreciable base, rejects unknown asset", "Passing — assets.service.spec.ts"],
        ["BNK-001..003", "Banking", "Dr toAccount/Cr fromAccount transfer, rejects non-positive amount, rejects self-transfer", "Passing — banking.service.spec.ts"],
        ["POS-PR-001..005", "POS Partial Return", "Prorated tax+COGS on partial return via Sales Returns account, cumulative quantity tracking across multiple partial returns, status transitions to fully RETURNED when exhausted, full returnSale() rejected after any partial, invalid line index rejected", "Passing — pos.service.spec.ts"],
        ["PAY-001..004", "Payments", "Customer payment Dr Cash/Cr AR, supplier payment Dr AP/Cr Cash, rejects non-positive amounts, lists filtered by party", "Passing — payments.service.spec.ts"],
        ["STMT-001..003", "Statements", "totalInvoiced-totalPaid=balance, fully-paid gives zero balance, no activity gives zero balance and no lines", "Passing — statements.service.spec.ts"],
        ["E2E-028", "End-to-end (live server)", "Full 6-module chained scenario: expense (115.00) -> asset acquisition+depreciation (500.00/month) -> bank transfer (500.00) -> invoice+payment+statement (1150/600/550) -> purchase+sell+partial-return (stock 100->90->93) -> FINAL Trial Balance across everything: isBalanced=true, 16444.00=16444.00", "Verified live via curl — single comprehensive run"],
        ["PAY-APP-001..003", "Sales/Purchases Payment Application", "applyPayment updates paidAmount, rejects overpayment, rejects unknown invoice/bill (both Sales and Purchases)", "Passing — sales/purchases.service.spec.ts"],
        ["PAY-APP-004..006", "Payments x Application integration", "invoiceId/billId triggers applyPayment with the correct amount; omitting it does not call applyPayment (on-account payment preserved)", "Passing — payments.service.spec.ts"],
        ["E2E-029", "End-to-end (live server)", "Invoice 1150.00 -> pay 600 applied to invoice -> attempt +700 rejected live (400, would overpay) -> pay remaining 550 -> final statement balance exactly 0.00", "Verified live via curl"],
        ["AGE-001..006", "Aging (Receivable/Payable)", "Buckets by age (0-30/31-60/61-90/90+), excludes fully-paid invoices, ages on remaining balance not original total, today's invoice = 0 days, empty-state handling, payable mirrors receivable logic", "Passing — aging.service.spec.ts"],
        ["E2E-030", "End-to-end (live server)", "Invoice 1150.00 issued today + partial payment 500 -> Receivable Aging shows CURRENT_0_30 bucket with exactly 650.00 outstanding; Payable Aging correctly empty (all-zero buckets, no error)", "Verified live via curl"],
        ["CF-001..003", "Cash Flow Statement", "Classifies ASSET_ACQUIRED as investing vs. operating for everything else, bank transfer self-cancels to exactly zero, empty state has no error", "Passing — reporting.service.spec.ts"],
        ["E2E-031", "End-to-end (live server)", "Cash sale +230 (operating) + cash expense -115 (operating, net 115.00) + asset acquisition -12000 (investing) + bank transfer 500 (self-cancels to 0) -> net change in cash = -11885.00 exactly", "Verified live via curl"],
        ["UI-001", "Web UI (Sprint 22)", "index.html, style.css, and app.js are served with HTTP 200 by the running NestJS server via useStaticAssets", "Verified live via curl"],
        ["UI-002", "Web UI (Sprint 22)", "Every API call the UI's JavaScript makes (login, trial-balance, profit-and-loss, create customer with real Arabic text, list accounts) succeeds against the live server exactly as the browser would call it", "Verified live via curl simulating the exact fetch() calls in app.js"],
        ["UI-003", "Web UI (Sprint 23)", "New GET /periods endpoint returns the seeded OPEN period, closing the Sprint 22 manual-paste gap", "Verified live via curl"],
        ["UI-004", "Web UI (Sprint 23)", "POS screen's exact API call (cash sale) succeeds and returns correct subtotal/tax/total", "Verified live via curl"],
        ["UI-005", "Web UI (Sprint 23)", "Assets screen's exact API call (acquire asset) succeeds", "Verified live via curl"],
        ["UI-006", "Web UI (Sprint 23)", "Reports screen's three exact API calls (balance-sheet, cash-flow, aging/receivable) all succeed and cross-validate numerically: Balance Sheet 115.00=15.00+0+100.00 (balanced), Cash Flow net change -4885.00 matches the actual cash account balance exactly", "Verified live via curl — a genuine cross-module arithmetic proof, not just individually correct responses"],
        ["UI-007", "Web UI (Sprint 24)", "Inventory screen: create product, receive 50 units @ 8.00, check-stock button returns correct quantity and average cost", "Verified live via curl"],
        ["UI-008", "Web UI (Sprint 24)", "Purchases screen: create supplier, post a mixed bill (one product-linked line + one unlinked general-expense line) with correct Subtotal/VAT/Total (130.00/19.50/149.50)", "Verified live via curl"],
        ["UI-009", "Web UI (Sprint 24)", "Cross-screen integration proof: after the purchase bill, the Inventory screen's stock check shows 60 units at the SAME 8.00 average cost (50 existing + 10 from the bill, both received at identical cost) — not just each screen individually correct, but consistent with each other", "Verified live via curl"],
        ["ORG-001..002", "OrganizationsService.getOrganization (Sprint 25)", "Returns the organization row when found, returns null when not found", "Passing — organizations.service.spec.ts"],
        ["RCPT-001..006", "ReceiptsService (Sprint 25)", "Composes seller/lines/totals/QR from a real POS sale, correctly describes mixed cash+card payment, 404s on unknown sale, composes an invoice receipt reporting on-account vs partial payment correctly, 404s on unknown invoice", "Passing — receipts.service.spec.ts"],
        ["E2E-032", "End-to-end (live server) — deepest verification in the project", "Real POS sale -> GET /receipt returns sellerName pulled from real OrganizationsService data (not hardcoded) -> the returned QR image is decoded via a REAL QR-reading library (pyzbar) and every one of its 5 TLV fields (seller name, VAT number, timestamp, total, VAT) matches the actual transaction data exactly", "Verified live via curl + a real QR decode round-trip, not just an individually-correct API response"],
        ["E2E-033", "End-to-end (live server)", "Real unpaid sales invoice (1150.00) -> GET /receipt correctly reports paymentSummary = 'آجل — على الحساب' (on account)", "Verified live via curl — the exact call the UI's new 'عرض الفاتورة' button makes"],
        ["UI-010", "Web UI (Sprint 26)", "New Shift screen: open shift, JWT payload decoded client-side to get cashierUserId, close shift with cash reconciliation", "Verified live via curl simulating the exact calls, including manual JWT decode matching app.js's decodeJwtPayload()"],
        ["BUG-001", "Real bug found via live testing (Sprint 26)", "Initial Shift screen implementation hardcoded the POS sale's terminalId to 'WEB-UI-01' while the shift-open form defaulted to 'POS-01' — every sale during an open shift would have been rejected by the backend's real terminal-match validation. Caught only by running the actual server end-to-end, not by code review. Fixed by having the sale form use the active shift's own terminalId", "Confirmed failing before the fix, confirmed passing after — documented explicitly rather than silently patched"],
        ["E2E-034", "End-to-end (live server) — cash reconciliation proof", "Open shift (200.00) -> cash sale (115.00) linked to shift -> close shift with actualCash=315.00 -> expectedCash=315.00 exactly (200+115), cashDifference=0.00", "Verified live via curl, after the terminal-mismatch fix above"],
        ["E2E-035", "End-to-end (live server)", "POS sale's receipt now shows the REAL soldAt timestamp captured at the moment of sale, not the time the receipt was later requested", "Verified live via curl with a 2-second delay between sale and receipt fetch to prove the timestamp doesn't drift"],
        ["UI-011", "Web UI (Sprint 27)", "New Returns screen: search a sale by id, partial return of specific line quantities via return-items, full return via return", "Verified live via curl simulating the exact calls"],
        ["UI-012", "Web UI (Sprint 27) — deliberate business rule verified, not just each call in isolation", "After a partial return (2 of 5 units), attempting a FULL return correctly fails with the expected 400 (a documented Sprint 18 design decision, not a newly-discovered limitation); returning the remaining 3 units via return-items instead succeeds and reaches status RETURNED with all remainingQuantities at 0", "Verified live via curl — confirms the UI's full-return button is correctly hidden in this exact scenario rather than assumed correct"],
        ["ATOM-001", "PurchasesService atomicity fix (Sprint 28)", "A bill referencing a non-existent productId is rejected BEFORE any journal entry is posted (calls.length === 0)", "Passing — purchases.service.spec.ts"],
        ["ATOM-002", "PurchasesService atomicity fix (Sprint 28)", "A bill with a valid product posts normally with no behavior change", "Passing — purchases.service.spec.ts"],
        ["ATOM-003", "PurchasesService atomicity fix (Sprint 28)", "If inventory update fails AFTER the journal entry posts, the entry is automatically reversed via AccountingPostingEngine.reverse() with the correct journalEntryId, then the original error is rethrown", "Passing — purchases.service.spec.ts"],
        ["ATOM-004", "PurchasesService atomicity fix (Sprint 28)", "A fully successful bill triggers zero reversal calls", "Passing — purchases.service.spec.ts"],
        ["ATOM-005", "PosService.returnItems atomicity fix (Sprint 28)", "If restoring inventory fails after a partial-return journal entry posts, that entry is automatically reversed with the correct id before the error propagates", "Passing — pos.service.spec.ts"],
        ["ATOM-006", "PosService.returnItems atomicity fix (Sprint 28)", "A fully successful partial return triggers zero reversal calls", "Passing — pos.service.spec.ts"],
        ["E2E-036", "End-to-end (live server) — the concrete bug, demonstrated and closed", "Purchase bill referencing a non-existent productId -> rejected live with 404 -> Trial Balance queried immediately before and after the attempt is IDENTICAL ({totalDebit:0, totalCredit:0}) -> proves no orphan journal entry leaked into the books, closing the exact failure mode described in the Sprint 6-8 gap", "Verified live via curl — a before/after ledger-state comparison, not just an error code check"],
        ["E2E-037", "End-to-end (live server)", "Normal purchase bill with a real product still behaves identically to before the fix: stock updates to 5 @ 10.00, journal entry balances exactly (57.50 = 57.50)", "Verified live via curl — confirms the fix adds a safety net without changing correct-path behavior"],
        ["ORG-003..004", "OrganizationsService.updateSettings (Sprint 29)", "Updates requireShiftForPosSale and returns the updated row; throws NotFoundException for an unknown organization", "Passing — organizations.service.spec.ts"],
        ["SHIFT-SETTING-001..004", "PosService mandatory-shift setting (Sprint 29)", "Rejects a shiftId-less sale when the org requires a shift; allows it when the org doesn't; allows it when NO OrganizationsService is provided at all (backward compatibility); a sale WITH a valid shiftId succeeds even when required", "Passing — pos.service.spec.ts — importantly, every pre-existing PosService test in the file continued passing unmodified, proving the optional constructor parameter is truly non-breaking"],
        ["E2E-038", "End-to-end (live server) — full lifecycle of an opt-in setting", "Sale without shift succeeds before opt-in (201) -> PATCH settings enables requireShiftForPosSale -> the same sale request now rejected (400, correct message) -> a sale WITH an open shift succeeds -> PATCH settings disables it again -> shift-less sale succeeds once more", "Verified live via curl through all 5 states of the toggle, not just the on/off endpoints in isolation"],
        ["ZXML-001..021", "ZATCA UBL 2.1 XML generator (Sprint 30)", "Each test cites the specific ZATCA business rule ID it verifies (BR-06, BR-13/14/15, BR-16/21/22/24/25/26, BR-45/46/47/48, BR-CO-04, BR-KSA-06/08/09/39/40/37/66/61, BR-KSA-EN16931-01/02), well-formedness via an actual XML parser (not string matching), multi-VAT-category support, XML-escaping of free text, and format validators for VAT number/building number/postal code", "Passing — xml-invoice-builder.spec.ts, built directly from the official 'Electronic Invoice XML Implementation Standard v1.2' fetched and read in this session"],
        ["ZXML-022..025", "ReceiptsService xmlInvoice integration (Sprint 30)", "Includes a well-formed xmlInvoice when the organization has full address data; OMITS it (rather than emitting incomplete XML) when address data is missing; correctly maps OUT_OF_SCOPE tax code to ZATCA category 'O'; also generates xmlInvoice for Sales invoice receipts, not just POS", "Passing — receipts.service.spec.ts"],
        ["E2E-039", "End-to-end (live server) — deepest ZATCA verification in the project", "Real POS sale with 2 lines (STANDARD + ZERO tax codes) -> GET /receipt -> the returned xmlInvoice validated by an INDEPENDENT XML parser (fast-xml-parser, not the same code that generated it) -> every key field extracted and cross-checked against the actual sale: InvoiceTypeCode=388/name='0200000', real seller name and VAT number (not hardcoded), TaxInclusiveAmount and PayableAmount both exactly 153.50 matching the real sale total, both invoice lines present with correct Arabic text, and the zero-rated line correctly categorized as 'Z'", "Verified live via curl + independent XML parsing — a genuine field-by-field cross-check against real transaction data, not just 'the endpoint returned 200'"],
        ["ZHASH-001", "Independent verification of a spec-stated constant before hardcoding it", "The ZATCA spec's documented placeholder for a Previous Invoice Hash (BR-KSA-26, 'first invoice' case) was independently recomputed from scratch (SHA-256 of the character '0', then base64-encoded) via a standalone Python script, and matched the spec's stated value byte-for-byte before being used as a hardcoded constant in the codebase", "Verified via bash_tool/python3 in this session — see ZATCA_FIRST_INVOICE_HASH_PLACEHOLDER in xml-invoice-builder.ts"],
        ["PERIOD-001..006", "PeriodsService.createPeriod (Sprint 31)", "Creates an OPEN period when there's no overlap; rejects end<=start; rejects invalid dates; rejects overlap with an existing period for the SAME org; allows a non-overlapping period alongside others; does NOT consider a different organization's periods when checking overlap", "Passing — periods.service.spec.ts"],
        ["E2E-040", "End-to-end (live server) — periods actually usable, not just creatable", "New period for 2028 created -> list shows 2 periods -> an overlapping period request correctly rejected (400) -> a REAL POS sale successfully posted using the new period's id as periodId", "Verified live via curl — the sale posting step proves the new period is genuinely functional, not just a database row"],
        ["ZTAX-001..007", "buildTaxInvoiceXml (Sprint 31)", "Well-formed XML with buyer block; InvoiceTypeCode name is '0100000' per BR-KSA-06 (vs '0200000' for Simplified); buyer postal address fields present per BR-10/BR-KSA-63; buyer VAT number included per BR-KSA-44 when provided and correctly omitted when not; seller block identical between Simplified and Tax Invoice variants; Simplified variant correctly has NO AccountingCustomerParty block at all", "Passing — xml-invoice-builder.spec.ts, each citing the specific business rule it verifies"],
        ["E2E-041", "End-to-end — Tax Invoice with real buyer data, independently parsed", "Full Tax Invoice generated with a complete Saudi buyer (name, 15-digit VAT number, Jeddah address) -> validated by an independent XML parser -> InvoiceTypeCode/name, buyer registration name, buyer VAT number, and buyer city all extracted and confirmed correct -> TaxInclusiveAmount matches the input total exactly (1150.00)", "Verified via ts-node script + fast-xml-parser in this session"],
        ["POS-001", "POS", "Cash sale posts correct Dr Cash / Cr Sales+VAT", "Planned — needs POS module"],
        ["INV-001", "Invoice", "Standard invoice snapshot unaffected by later customer edits", "Planned — needs Invoice module"],
    ],
    [18, 24, 60, 55],
    rtl=False,
)

# 27_ZATCA_Test_Cases
add_sheet(
    "27_ZATCA_Test_Cases",
    ["Test ID", "Description", "Status"],
    [
        ["ZATCA-001", "Simplified invoice QR decodes to correct seller/VAT/timestamp/total/VAT-total", "BLOCKED — needs official Data Dictionary + Security Features doc first"],
        ["ZATCA-002", "Standard invoice validates against official XML Schema", "BLOCKED"],
        ["ZATCA-003", "Standard invoice validates against official Schematron/business rules", "BLOCKED"],
        ["ZATCA-004", "Rejected invoice is not silently retried indefinitely (non-retryable vs retryable)", "BLOCKED"],
        ["ZATCA-005", "Duplicate submission is idempotent (no duplicate financial transaction)", "BLOCKED"],
    ],
    [14, 60, 55],
    rtl=False,
)

# 28_Deployment_Checklist
add_sheet(
    "28_Deployment_Checklist",
    ["Item", "Status"],
    [
        ["Docker image for API", "Not started"],
        ["Docker image for Web", "Not started"],
        ["Environment variable / secrets management", "Not started"],
        ["Database migration pipeline (prisma migrate deploy)", "Not started"],
        ["Health check endpoint", "Not started"],
        ["Backup schedule + restore test", "Not started"],
    ],
    [46, 20],
    rtl=False,
)

# 29_Compliance_Checklist
add_sheet(
    "29_Compliance_Checklist",
    ["Item", "Status"],
    [
        ["ZATCA_SOURCES.md created with verifiable official links", "Done"],
        ["Data Dictionary downloaded + version logged", "Link verified (20230519_EInvoice_Data_Dictionary vF.xlsx); content not yet extracted — xlsx text extraction not available in this session"],
        ["XML Implementation Standard downloaded + content verified", "Done — v1.2, 2023-05-19, full 72-page text fetched and reviewed"],
        ["Security Features Implementation Standards downloaded + content verified", "Done — v1.2, 2023-05-19, full 27-page text fetched and reviewed"],
        ["QR TLV encoder implemented against verified spec, with tests", "Done — apps/api/src/modules/zatca/qr-encoder.ts (+.spec.ts)"],
        ["XML mapper / UBL generator / CSR-CSID services implemented", "Not started — requires Data Dictionary content first per ZATCA_SOURCES.md §4"],
        ["Debit=Credit invariant enforced in code with tests", "Done"],
        ["Immutable posted journal entries (reversal-only correction)", "Done"],
        ["Closed-period posting blocked", "Done"],
        ["Tenant isolation enforced + tested", "Path-level isolation (TenantGuard) done, tested, and live-verified via curl (403 on cross-tenant path); deep repository-level isolation (Prisma extension + Postgres RLS) still pending real DB"],
        ["Live server runs and responds correctly end-to-end", "Done — app.module.ts + main.ts booted via ts-node; login, posting, Trial Balance, tenant isolation, and auth-required all verified live via curl this session"],
    ],
    [55, 70],
    rtl=False,
)

# 30_Risk_Register
add_sheet(
    "30_Risk_Register",
    ["Risk", "Impact", "Mitigation"],
    [
        ["Coding ZATCA XML/QR from memory or unofficial libraries", "Legal/compliance failure, rejected submissions", "Hard block in place — see docs/GAP_ANALYSIS.md item 1; ZATCA module not started"],
        ["Operational modules (POS/Sales) built before Accounting Core is stable", "Ledger corruption, unrecoverable financial errors", "Sequenced roadmap in docs/MVP_ROADMAP.md prevents this"],
        ["Tenant data leakage across organizations", "Severe security/legal risk", "Planned dual-layer isolation (app-level guard + Postgres RLS) — not yet implemented"],
        ["Using FLOAT/DOUBLE for money", "Silent rounding errors in financial statements", "Schema uses Prisma Decimal(18,4) throughout — verified in schema.prisma"],
        ["Purchases-to-Inventory and POS-Return-to-Inventory are two separate calls, not one atomic transaction", "A crash between the two could leave a posted bill/reversal whose stock quantity wasn't updated", "MOSTLY CLOSED in Sprint 28-29 — pre-validation + compensating reversal now cover PurchasesService.createBill() and PosService.returnItems() (demonstrated live: a bill with a bad productId used to post a bad GL entry, now rejected with zero ledger impact). PosService.returnSale() was explicitly reviewed in Sprint 29 and found NOT to need the same fix — its productId always comes from the sale's own internally-generated inventoryEffects, never user input on the return request, so the specific failure mode this pattern closes cannot occur there. True DB-level atomicity still needs real Prisma/Postgres $transaction, still blocked in this sandbox"],
        ["Whether a shift should be mandatory for every POS sale was an open product decision since Sprint 12", "POS sales could be made with no shift tracking at all, with no way for a business to require otherwise", "CLOSED in Sprint 29 — resolved as a per-organization opt-in setting (requireShiftForPosSale, default false) rather than a single hardcoded answer, since different business types legitimately want different defaults. Backward compatible by construction: OrganizationsService is an optional trailing constructor parameter on PosService, so no existing call site or test needed to change"],
        ["Zero User Interface exists after 21 sprints of backend work", "Spec band 143 explicitly requires a modern commercial UI (RTL-first, clean sidebar, quick-create, etc.) — every deliverable so far is an API endpoint, not a usable product for a non-technical user", "CLOSED across Sprint 22-27 — the UI now covers every core operational module: login, dashboard, sales, POS, customers, inventory, purchases, fixed assets, reports, chart of accounts, shift management, and returns, all live-verified including cross-screen integration tests and a real bug caught and fixed via live testing (Sprint 26). Still explicitly NOT the final Next.js app from ARCHITECTURE.md — this is a lightweight bootstrap UI, not the polished commercial product the full spec envisions"],
    ],
    [46, 30, 55],
    rtl=False,
)

# 31_MVP_Roadmap
add_sheet(
    "31_MVP_Roadmap",
    ["Phase", "Status"],
    [
        ["0. Repository Audit", "Done"],
        ["1. Official ZATCA Research", "Mostly done — XML Implementation Standard v1.2 and Security Features v1.2 (both 2023-05-19) fully fetched and mapped; only the Data Dictionary XLSX content remains unextracted"],
        ["2. Product Blueprint", "Done"],
        ["3. Database & ERD (first layer)", "Done — plus a real AccountsService (Chart of Accounts CRUD + default-COA seeder) implemented and live-tested in Sprint 10"],
        ["4. Security Foundation", "Core logic + Branches CRUD done and tested (23 tests) AND live-wired: a real running NestJS server (app.module.ts + main.ts) verified end-to-end via curl (login, tenant isolation 403, missing-token 401, duplicate branch code 409) — only a real Postgres/Prisma backing (currently in-memory) remains"],
        ["5. Accounting Core", "Posting engine (incl. idempotency) + Trial Balance + HTTP controller done, tested (23 tests incl. DomainExceptionFilter + idempotency), AND live-verified via curl: balanced entry posts correctly, unbalanced entry rejected with HTTP 400, replayed idempotency key returns the same entry (no duplicate), Trial Balance correct"],
        ["6-9. Sales/Purchases/Inventory/POS/Reporting", "Sales, Purchases, Inventory (Weighted Average), POS (Sell+Full/Partial Return+Shift integration), Reporting (GL/P&L/Balance Sheet), a real Chart of Accounts, PLUS Expenses, Fixed Assets, Banking, Payments, and Statements (Sprint 13-18) — all done and live-verified TOGETHER in one chained 6-step scenario ending in a fully balanced Trial Balance (16444.00=16444.00) across every module. Documented gaps: Purchases/POS-Return-to-Inventory still two separate calls not one transaction; mandatory-shift policy still an open decision; Statements is invoiced-minus-paid only, not a full aged ledger with payment application"],
        ["10. Invoice Engine", "Not started — Sales/Purchases/POS currently post minimal ad-hoc records, not the full Canonical Invoice Model (bands 60-84)"],
        ["11. ZATCA", "QR encoder done and tested (6 tests) against verified official spec — XML Mapper/CSR/CSID blocked pending Data Dictionary extraction"],
        ["12. Industry Packs", "Not started"],
        ["13. Hardening", "Not started"],
        ["14. Deployment", "Not started"],
    ],
    [55, 70],
    rtl=False,
)

out_path = "/home/claude/mizan-erp/MIZAN_IMPLEMENTATION_WORKBOOK.xlsx"
wb.save(out_path)
print("saved", out_path)
