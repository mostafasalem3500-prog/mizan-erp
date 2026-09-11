const state = {
  token: localStorage.getItem("mizan_token") || null,
  orgId: localStorage.getItem("mizan_org") || null,
  periodId: null,
  customers: [],
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body && body.message) || `HTTP ${res.status}`;
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return body;
}

// ---------- تسجيل الدخول ----------
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;

  try {
    const result = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.token = result.accessToken;
    // Sprint 36 — the organization is no longer typed in by the user; the
    // server resolves it and encodes it in the JWT, so read it back from
    // there. This is the same value the server will enforce on every
    // subsequent request via TenantGuard, so it can't drift from what the
    // token actually authorizes.
    const payload = decodeJwtPayload(state.token);
    state.orgId = payload ? payload.organizationId : null;
    if (!state.orgId) throw new Error("تعذّر تحديد المنظمة من رمز الدخول");
    localStorage.setItem("mizan_token", state.token);
    localStorage.setItem("mizan_org", state.orgId);
    await enterApp();
  } catch (err) {
    errorEl.textContent = "فشل تسجيل الدخول: " + err.message;
    errorEl.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem("mizan_token");
  localStorage.removeItem("mizan_org");
  location.reload();
});

// ---------- التنقل ----------
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.getElementById("quick-create").addEventListener("click", () => showView("invoices"));

function showView(name) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  const titles = {
    dashboard: "نظرة عامة",
    invoices: "فواتير المبيعات",
    pos: "نقطة البيع",
    shift: "الوردية",
    returns: "الإرجاع",
    customers: "العملاء",
    inventory: "المخزون",
    purchases: "المشتريات",
    assets: "الأصول الثابتة",
    reports: "التقارير",
    accounts: "دليل الحسابات",
  };
  document.getElementById("view-title").textContent = titles[name];
  if (name === "dashboard") loadDashboard();
  if (name === "customers") loadCustomers();
  if (name === "accounts") loadAccounts();
  if (name === "invoices") loadCustomersIntoInvoiceForm();
  if (name === "pos") loadPosView();
  if (name === "shift") loadShiftView();
  if (name === "returns") loadReturnsView();
  if (name === "reports") loadReports();
  if (name === "inventory") loadInventoryView();
  if (name === "purchases") loadPurchasesView();
}

// ---------- الدخول إلى التطبيق ----------
async function enterApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  const storedShift = localStorage.getItem("mizan_shift_" + state.orgId);
  if (storedShift) {
    state.shiftId = storedShift;
    state.shiftTerminalId = localStorage.getItem("mizan_shift_terminal_" + state.orgId);
  }
  try {
    await loadDashboard();
  } catch (err) {
    alert("تعذّر تحميل البيانات: " + err.message);
  }
}

// ---------- الرئيسية ----------
async function findAnOpenPeriodId() {
  if (state.periodId) return state.periodId;
  const stored = localStorage.getItem("mizan_period_" + state.orgId);
  if (stored) {
    state.periodId = stored;
    return stored;
  }
  // Sprint 23: نجلب الفترة تلقائيًا عبر /periods بدل اللصق اليدوي —
  // نأخذ أول فترة OPEN إن وُجدت.
  try {
    const periods = await api(`/api/v1/organizations/${state.orgId}/periods`);
    const open = periods.find((p) => p.status === "OPEN");
    if (open) {
      state.periodId = open.id;
      localStorage.setItem("mizan_period_" + state.orgId, open.id);
      return open.id;
    }
  } catch (err) {
    console.warn("Could not auto-fetch periods:", err.message);
  }
  return null;
}

document.getElementById("view-dashboard").insertAdjacentHTML(
  "afterbegin",
  `<div class="panel" style="margin-bottom:20px">
     <h3>ربط الفترة المحاسبية</h3>
     <div class="inline-form">
       <input type="text" id="period-input" placeholder="Period ID (من سجل تشغيل الخادم: Demo accounting period id)" style="flex:1" />
       <button class="primary-btn" id="save-period">حفظ</button>
     </div>
   </div>`,
);

document.getElementById("save-period").addEventListener("click", () => {
  const val = document.getElementById("period-input").value.trim();
  if (val) {
    state.periodId = val;
    localStorage.setItem("mizan_period_" + state.orgId, val);
    loadDashboard();
  }
});

async function loadDashboard() {
  const periodId = await findAnOpenPeriodId();
  const savedInput = document.getElementById("period-input");
  if (savedInput && state.periodId) savedInput.value = state.periodId;
  if (!periodId) return;

  try {
    const [trialBalance, pnl] = await Promise.all([
      api(`/api/v1/organizations/${state.orgId}/accounting/periods/${periodId}/trial-balance`),
      api(`/api/v1/organizations/${state.orgId}/reports/periods/${periodId}/profit-and-loss`),
    ]);

    document.getElementById("kpi-debit").textContent = trialBalance.totalDebit;
    document.getElementById("kpi-credit").textContent = trialBalance.totalCredit;
    document.getElementById("kpi-balanced").textContent = trialBalance.isBalanced ? "متوازن ✓" : "غير متوازن ✗";
    document.getElementById("kpi-income").textContent = pnl.netIncome;

    const tbody = document.querySelector("#pnl-table tbody");
    tbody.innerHTML = `
      <tr><td>الإيرادات</td><td class="num">${pnl.revenue}</td></tr>
      <tr><td>تكلفة المبيعات</td><td class="num">${pnl.costOfSales}</td></tr>
      <tr><td>مجمل الربح</td><td class="num">${pnl.grossProfit}</td></tr>
      <tr><td>المصروفات التشغيلية</td><td class="num">${pnl.operatingExpenses}</td></tr>
      <tr><td><strong>صافي الدخل</strong></td><td class="num"><strong>${pnl.netIncome}</strong></td></tr>
    `;
  } catch (err) {
    console.warn("Dashboard load failed (likely wrong period id):", err.message);
  }
}

// ---------- العملاء ----------
document.getElementById("customer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("customer-name").value.trim();
  if (!name) return;
  await api(`/api/v1/organizations/${state.orgId}/customers`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  document.getElementById("customer-name").value = "";
  await loadCustomers();
});

async function loadCustomers() {
  state.customers = await api(`/api/v1/organizations/${state.orgId}/customers`);
  const tbody = document.getElementById("customers-table-body");
  tbody.innerHTML = state.customers
    .map((c) => `<tr><td>${c.name}</td><td class="num" style="direction:ltr;font-size:11px;color:#999">${c.id}</td></tr>`)
    .join("");
}

async function loadCustomersIntoInvoiceForm() {
  if (state.customers.length === 0) await loadCustomers();
  const select = document.getElementById("invoice-customer");
  select.innerHTML = state.customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  if (document.getElementById("invoice-lines").children.length === 0) addInvoiceLine();
}

// ---------- الفواتير ----------
function addInvoiceLine() {
  const row = document.createElement("div");
  row.className = "line-row";
  row.innerHTML = `
    <input type="text" placeholder="الوصف" class="line-desc" required />
    <input type="number" placeholder="الكمية" class="line-qty" value="1" min="1" required />
    <input type="number" placeholder="السعر" class="line-price" step="0.01" required />
    <select class="line-tax">
      <option value="STANDARD">خاضع 15%</option>
      <option value="ZERO">نسبة صفر</option>
      <option value="EXEMPT">معفى</option>
    </select>
  `;
  document.getElementById("invoice-lines").appendChild(row);
}
document.getElementById("add-line").addEventListener("click", addInvoiceLine);

document.getElementById("invoice-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("invoice-result");
  const periodId = await findAnOpenPeriodId();
  if (!periodId) {
    resultEl.textContent = "يجب حفظ معرّف الفترة المحاسبية من الرئيسية أولًا.";
    return;
  }

  const lines = [...document.querySelectorAll("#invoice-lines .line-row")].map((row) => ({
    description: row.querySelector(".line-desc").value,
    quantity: Number(row.querySelector(".line-qty").value),
    unitPrice: Number(row.querySelector(".line-price").value),
    taxCode: row.querySelector(".line-tax").value,
  }));

  try {
    const invoice = await api(`/api/v1/organizations/${state.orgId}/sales/invoices`, {
      method: "POST",
      body: JSON.stringify({
        periodId,
        customerId: document.getElementById("invoice-customer").value,
        lines,
      }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.innerHTML = `تم الترحيل بنجاح — الإجمالي ${invoice.total} ريال (المعرّف: ${invoice.id}) &nbsp; <button type="button" class="ghost-btn" id="view-invoice-receipt" style="margin:0;padding:4px 12px">عرض الفاتورة</button>`;
    document.getElementById("view-invoice-receipt").addEventListener("click", () => openInvoiceReceipt(invoice.id));
    document.getElementById("invoice-lines").innerHTML = "";
    addInvoiceLine();
    loadDashboard();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الترحيل: " + err.message;
  }
});

// ---------- دليل الحسابات ----------
async function loadAccounts() {
  const accounts = await api(`/api/v1/organizations/${state.orgId}/accounts`);
  const tbody = document.getElementById("accounts-table-body");
  tbody.innerHTML = accounts
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => `<tr><td class="num">${a.code}</td><td>${a.nameEn || a.nameAr}</td><td>${a.type}</td></tr>`)
    .join("");
}

// ---------- الإقلاع ----------
if (state.token && state.orgId) {
  enterApp();
}

// ---------- نقطة البيع ----------
function addPosLine() {
  const row = document.createElement("div");
  row.className = "line-row";
  row.innerHTML = `
    <input type="text" placeholder="الوصف" class="pos-line-desc" required />
    <input type="number" placeholder="الكمية" class="pos-line-qty" value="1" min="1" required />
    <input type="number" placeholder="السعر" class="pos-line-price" step="0.01" required />
    <select class="pos-line-tax">
      <option value="STANDARD">خاضع 15%</option>
      <option value="ZERO">نسبة صفر</option>
      <option value="EXEMPT">معفى</option>
    </select>
  `;
  document.getElementById("pos-lines").appendChild(row);
}

function loadPosView() {
  if (document.getElementById("pos-lines").children.length === 0) addPosLine();
}
document.getElementById("pos-add-line").addEventListener("click", addPosLine);

document.getElementById("pos-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("pos-result");
  const periodId = await findAnOpenPeriodId();
  if (!periodId) {
    resultEl.textContent = "تعذّر تحديد الفترة المحاسبية.";
    return;
  }

  const lines = [...document.querySelectorAll("#pos-lines .line-row")].map((row) => ({
    description: row.querySelector(".pos-line-desc").value,
    quantity: Number(row.querySelector(".pos-line-qty").value),
    unitPrice: Number(row.querySelector(".pos-line-price").value),
    taxCode: row.querySelector(".pos-line-tax").value,
  }));

  const rateByCode = { STANDARD: 0.15, ZERO: 0, EXEMPT: 0 };
  const total = lines.reduce((sum, l) => {
    const net = l.quantity * l.unitPrice;
    return sum + net + net * (rateByCode[l.taxCode] ?? 0);
  }, 0);

  try {
    const sale = await api(`/api/v1/organizations/${state.orgId}/pos/sales`, {
      method: "POST",
      body: JSON.stringify({
        periodId,
        terminalId: state.shiftId ? state.shiftTerminalId : "WEB-UI-01",
        lines,
        tenders: [{ method: "CASH", amount: Number(total.toFixed(2)) }],
        ...(state.shiftId ? { shiftId: state.shiftId } : {}),
      }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.innerHTML = `تم البيع بنجاح — الإجمالي ${sale.total} ريال (المعرّف: ${sale.id}) &nbsp; <button type="button" class="ghost-btn" id="view-pos-receipt" style="margin:0;padding:4px 12px">عرض الفاتورة</button>`;
    document.getElementById("view-pos-receipt").addEventListener("click", () => openPosReceipt(sale.id));
    document.getElementById("pos-lines").innerHTML = "";
    addPosLine();
    loadDashboard();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل البيع: " + err.message;
  }
});

// ---------- الأصول الثابتة ----------
document.getElementById("asset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("asset-result");
  const periodId = await findAnOpenPeriodId();
  if (!periodId) {
    resultEl.textContent = "تعذّر تحديد الفترة المحاسبية.";
    return;
  }
  try {
    const asset = await api(`/api/v1/organizations/${state.orgId}/assets`, {
      method: "POST",
      body: JSON.stringify({
        periodId,
        name: document.getElementById("asset-name").value,
        cost: Number(document.getElementById("asset-cost").value),
        residualValue: Number(document.getElementById("asset-residual").value || 0),
        usefulLifeMonths: Number(document.getElementById("asset-life").value),
        paymentAccountCode: "1100",
      }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.textContent = `تم اقتناء الأصل "${asset.name}" بتكلفة ${asset.cost} ريال (المعرّف: ${asset.id})`;
    document.getElementById("asset-form").reset();
    loadDashboard();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الاقتناء: " + err.message;
  }
});

// ---------- التقارير ----------
async function loadReports() {
  const periodId = await findAnOpenPeriodId();
  if (!periodId) return;

  try {
    const bs = await api(`/api/v1/organizations/${state.orgId}/reports/periods/${periodId}/balance-sheet`);
    document.getElementById("bs-strip").innerHTML = `
      <div class="ledger-item"><span class="ledger-label">إجمالي الأصول</span><span class="ledger-value">${bs.totalAssets}</span></div>
      <div class="ledger-item"><span class="ledger-label">إجمالي الالتزامات</span><span class="ledger-value">${bs.totalLiabilities}</span></div>
      <div class="ledger-item"><span class="ledger-label">حقوق الملكية</span><span class="ledger-value">${bs.totalEquity}</span></div>
      <div class="ledger-item"><span class="ledger-label">صافي الدخل غير المُقفَل</span><span class="ledger-value">${bs.netIncomeNotYetClosed}</span></div>
      <div class="ledger-item"><span class="ledger-label">الحالة</span><span class="ledger-value">${bs.isBalanced ? "متوازن ✓" : "غير متوازن ✗"}</span></div>
    `;
  } catch (err) {
    console.warn("Balance sheet load failed:", err.message);
  }

  try {
    const cf = await api(`/api/v1/organizations/${state.orgId}/reports/periods/${periodId}/cash-flow`);
    document.querySelector("#cf-table tbody").innerHTML = `
      <tr><td>الأنشطة التشغيلية</td><td class="num">${cf.operatingActivities}</td></tr>
      <tr><td>الأنشطة الاستثمارية</td><td class="num">${cf.investingActivities}</td></tr>
      <tr><td>الأنشطة التمويلية</td><td class="num">${cf.financingActivities}</td></tr>
      <tr><td><strong>صافي التغير في النقدية</strong></td><td class="num"><strong>${cf.netChangeInCash}</strong></td></tr>
    `;
  } catch (err) {
    console.warn("Cash flow load failed:", err.message);
  }

  try {
    const aging = await api(`/api/v1/organizations/${state.orgId}/aging/receivable`);
    document.getElementById("aging-table-body").innerHTML = `
      <tr>
        <td class="num">${aging.bucketTotals.CURRENT_0_30}</td>
        <td class="num">${aging.bucketTotals.DAYS_31_60}</td>
        <td class="num">${aging.bucketTotals.DAYS_61_90}</td>
        <td class="num">${aging.bucketTotals.DAYS_90_PLUS}</td>
        <td class="num"><strong>${aging.totalOutstanding}</strong></td>
      </tr>
    `;
  } catch (err) {
    console.warn("Aging load failed:", err.message);
  }
}

// ---------- المخزون ----------
state.products = [];

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api(`/api/v1/organizations/${state.orgId}/products`, {
    method: "POST",
    body: JSON.stringify({
      sku: document.getElementById("product-sku").value,
      name: document.getElementById("product-name").value,
      unit: document.getElementById("product-unit").value,
      sellingPrice: Number(document.getElementById("product-price").value),
      taxCode: document.getElementById("product-tax").value,
    }),
  });
  document.getElementById("product-form").reset();
  document.getElementById("product-unit").value = "PCS";
  await loadInventoryView();
});

document.getElementById("receipt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("receipt-result");
  const periodId = await findAnOpenPeriodId();
  try {
    await api(`/api/v1/organizations/${state.orgId}/inventory/receipts`, {
      method: "POST",
      body: JSON.stringify({
        periodId,
        productId: document.getElementById("receipt-product").value,
        quantity: Number(document.getElementById("receipt-qty").value),
        unitCost: Number(document.getElementById("receipt-cost").value),
      }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.textContent = "تم استلام المخزون بنجاح.";
    document.getElementById("receipt-form").reset();
    await loadInventoryView();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الاستلام: " + err.message;
  }
});

async function loadInventoryView() {
  state.products = await api(`/api/v1/organizations/${state.orgId}/products`);
  const select = document.getElementById("receipt-product");
  select.innerHTML = state.products.map((p) => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join("");

  const tbody = document.getElementById("products-table-body");
  tbody.innerHTML = state.products
    .map(
      (p) => `<tr data-product-id="${p.id}">
        <td>${p.sku}</td><td>${p.name}</td>
        <td class="num stock-qty">—</td><td class="num stock-cost">—</td>
        <td><button class="ghost-btn check-stock" data-id="${p.id}" style="margin:0;padding:4px 10px">فحص</button></td>
      </tr>`,
    )
    .join("");

  tbody.querySelectorAll(".check-stock").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stock = await api(`/api/v1/organizations/${state.orgId}/inventory/products/${btn.dataset.id}/stock`);
      const row = tbody.querySelector(`tr[data-product-id="${btn.dataset.id}"]`);
      row.querySelector(".stock-qty").textContent = stock.quantityOnHand;
      row.querySelector(".stock-cost").textContent = stock.averageCost;
    });
  });
}

// ---------- المشتريات ----------
state.suppliers = [];

document.getElementById("supplier-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api(`/api/v1/organizations/${state.orgId}/suppliers`, {
    method: "POST",
    body: JSON.stringify({ name: document.getElementById("supplier-name").value }),
  });
  document.getElementById("supplier-name").value = "";
  await loadPurchasesView();
});

function addBillLine() {
  if (state.products.length === 0) return; // المنتجات تُحمَّل مسبقًا عبر loadPurchasesView
  const row = document.createElement("div");
  row.className = "line-row";
  row.innerHTML = `
    <input type="text" placeholder="الوصف" class="bill-line-desc" required />
    <input type="number" placeholder="الكمية" class="bill-line-qty" value="1" min="1" required />
    <input type="number" placeholder="تكلفة الوحدة" class="bill-line-cost" step="0.01" required />
    <select class="bill-line-product">
      <option value="">بدون ربط بمنتج (مصروف عام)</option>
      ${state.products.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}
    </select>
  `;
  document.getElementById("bill-lines").appendChild(row);
}
document.getElementById("bill-add-line").addEventListener("click", addBillLine);

async function loadPurchasesView() {
  state.suppliers = await api(`/api/v1/organizations/${state.orgId}/suppliers`);
  const tbody = document.getElementById("suppliers-table-body");
  tbody.innerHTML = state.suppliers
    .map((s) => `<tr><td>${s.name}</td><td class="num" style="direction:ltr;font-size:11px;color:#999">${s.id}</td></tr>`)
    .join("");

  const select = document.getElementById("bill-supplier");
  select.innerHTML = state.suppliers.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");

  if (state.products.length === 0) state.products = await api(`/api/v1/organizations/${state.orgId}/products`);
  if (document.getElementById("bill-lines").children.length === 0) addBillLine();
}

document.getElementById("bill-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("bill-result");
  const periodId = await findAnOpenPeriodId();

  const lines = [...document.querySelectorAll("#bill-lines .line-row")].map((row) => {
    const productId = row.querySelector(".bill-line-product").value;
    return {
      description: row.querySelector(".bill-line-desc").value,
      quantity: Number(row.querySelector(".bill-line-qty").value),
      unitCost: Number(row.querySelector(".bill-line-cost").value),
      taxCode: "STANDARD",
      ...(productId ? { productId } : {}),
    };
  });

  try {
    const bill = await api(`/api/v1/organizations/${state.orgId}/purchases/bills`, {
      method: "POST",
      body: JSON.stringify({ periodId, supplierId: document.getElementById("bill-supplier").value, lines }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.textContent = `تم ترحيل فاتورة الشراء — الإجمالي ${bill.total} ريال (المعرّف: ${bill.id})`;
    document.getElementById("bill-lines").innerHTML = "";
    addBillLine();
    loadDashboard();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الترحيل: " + err.message;
  }
});

// ---------- عرض الفاتورة/الإيصال (Sprint 25 — الربط الحقيقي) ----------
document.getElementById("receipt-close").addEventListener("click", () => {
  document.getElementById("receipt-overlay").hidden = true;
});

function renderReceiptHtml(r) {
  const rows = r.lines
    .map(
      (l) => `<tr><td>${l.description}</td><td class="num">${l.quantity}</td><td class="num">${l.unitPrice.toFixed(2)}</td><td class="num">${l.lineTotal}</td></tr>`,
    )
    .join("");
  const dt = new Date(r.issuedAt).toLocaleString("ar-SA", { hour12: true });
  return `
    <div class="rcpt-biz-name">${r.sellerName}</div>
    <div class="rcpt-biz-meta">${r.sellerVatNumber ? "الرقم الضريبي: " + r.sellerVatNumber : ""}</div>
    <div class="rcpt-title-band">فاتورة ضريبية</div>
    <div class="rcpt-meta-row"><span>رقم المستند</span><span class="val">${r.documentNumber}</span></div>
    <div class="rcpt-meta-row"><span>التاريخ والوقت</span><span class="val">${dt}</span></div>
    <table class="rcpt-table">
      <thead><tr><th>الصنف</th><th class="num">كمية</th><th class="num">سعر</th><th class="num">الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="rcpt-totals-row"><span>الإجمالي قبل الضريبة</span><span class="amt">${r.subtotal} ر.س</span></div>
    <div class="rcpt-totals-row"><span>ضريبة القيمة المضافة</span><span class="amt">${r.taxTotal} ر.س</span></div>
    <div class="rcpt-totals-row grand"><span>الإجمالي المستحق</span><span class="amt">${r.total} ر.س</span></div>
    <div class="rcpt-payment">${r.paymentSummary}</div>
    <div class="rcpt-qr-wrap">
      <img src="${r.qrCodeDataUrl}" alt="ZATCA QR" />
      <div class="rcpt-qr-caption">رمز استجابة سريعة مبني وفق حقول المرحلة الأولى الرسمية</div>
    </div>
  `;
}

async function openPosReceipt(saleId) {
  const receipt = await api(`/api/v1/organizations/${state.orgId}/pos/sales/${saleId}/receipt`);
  document.getElementById("receipt-content").innerHTML = renderReceiptHtml(receipt);
  document.getElementById("receipt-overlay").hidden = false;
}

async function openInvoiceReceipt(invoiceId) {
  const receipt = await api(`/api/v1/organizations/${state.orgId}/sales/invoices/${invoiceId}/receipt`);
  document.getElementById("receipt-content").innerHTML = renderReceiptHtml(receipt);
  document.getElementById("receipt-overlay").hidden = false;
}

// ---------- الوردية (POS Shift) — Sprint 26 ----------
function decodeJwtPayload(token) {
  try {
    const payloadB64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(payloadB64))));
  } catch {
    return null;
  }
}

function currentUserId() {
  const payload = decodeJwtPayload(state.token);
  return payload ? payload.userId : null;
}

async function loadShiftView() {
  const stored = localStorage.getItem("mizan_shift_" + state.orgId);
  if (stored) {
    const shift = await api(`/api/v1/organizations/${state.orgId}/pos/shifts/${stored}`);
    if (shift.status === "OPEN") {
      state.shiftId = stored;
      state.shiftTerminalId = shift.terminalId;
      document.getElementById("shift-closed-panel").hidden = true;
      document.getElementById("shift-open-panel").hidden = false;
      document.getElementById("shift-info-terminal").textContent = shift.terminalId;
      document.getElementById("shift-info-opening").textContent = shift.openingCash;
      return;
    }
    localStorage.removeItem("mizan_shift_" + state.orgId);
  }
  state.shiftId = null;
  state.shiftTerminalId = null;
  document.getElementById("shift-closed-panel").hidden = false;
  document.getElementById("shift-open-panel").hidden = true;
}

document.getElementById("shift-open-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const shift = await api(`/api/v1/organizations/${state.orgId}/pos/shifts/open`, {
    method: "POST",
    body: JSON.stringify({
      terminalId: document.getElementById("shift-terminal").value,
      cashierUserId: currentUserId(),
      openingCash: Number(document.getElementById("shift-opening-cash").value),
    }),
  });
  localStorage.setItem("mizan_shift_" + state.orgId, shift.id);
  localStorage.setItem("mizan_shift_terminal_" + state.orgId, shift.terminalId);
  await loadShiftView();
});

document.getElementById("shift-close-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const resultEl = document.getElementById("shift-result");
  try {
    const closed = await api(`/api/v1/organizations/${state.orgId}/pos/shifts/${state.shiftId}/close`, {
      method: "POST",
      body: JSON.stringify({ actualCash: Number(document.getElementById("shift-actual-cash").value) }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.textContent = `تم إغلاق الوردية — المتوقع ${closed.expectedCash} ر.س، الفعلي ${closed.actualCash} ر.س، الفرق ${closed.cashDifference} ر.س`;
    localStorage.removeItem("mizan_shift_" + state.orgId);
    localStorage.removeItem("mizan_shift_terminal_" + state.orgId);
    setTimeout(loadShiftView, 1200);
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الإغلاق: " + err.message;
  }
});

// ---------- الإرجاع (Sprint 27) ----------
state.currentReturnSale = null;

function loadReturnsView() {
  document.getElementById("return-sale-panel").hidden = true;
  document.getElementById("return-search-error").textContent = "";
  document.getElementById("return-sale-id").value = "";
}

document.getElementById("return-search-btn").addEventListener("click", async () => {
  const saleId = document.getElementById("return-sale-id").value.trim();
  const errorEl = document.getElementById("return-search-error");
  errorEl.textContent = "";
  if (!saleId) return;

  try {
    const sale = await api(`/api/v1/organizations/${state.orgId}/pos/sales/${saleId}`);
    if (!sale) throw new Error("لم يتم العثور على عملية البيع");
    if (sale.status === "RETURNED") {
      errorEl.textContent = "تم إرجاع هذه العملية بالكامل مسبقًا.";
      document.getElementById("return-sale-panel").hidden = true;
      return;
    }
    state.currentReturnSale = sale;
    const tbody = document.getElementById("return-lines-body");
    tbody.innerHTML = sale.lines
      .map(
        (l, i) => `<tr>
          <td>${l.description}</td>
          <td class="num">${l.quantity}</td>
          <td class="num">${sale.remainingQuantities[i]}</td>
          <td><input type="number" class="return-qty-input" data-line="${i}" min="0" max="${sale.remainingQuantities[i]}" value="0" style="width:70px" ${sale.remainingQuantities[i] === 0 ? "disabled" : ""} /></td>
        </tr>`,
      )
      .join("");
    document.getElementById("return-sale-panel").hidden = false;
    document.getElementById("return-result").textContent = "";
    document.getElementById("return-full-btn").hidden = sale.status === "PARTIALLY_RETURNED";
  } catch (err) {
    errorEl.textContent = "تعذّر العثور على العملية: " + err.message;
    document.getElementById("return-sale-panel").hidden = true;
  }
});

document.getElementById("return-partial-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("return-result");
  const items = [...document.querySelectorAll(".return-qty-input")]
    .map((input) => ({ lineIndex: Number(input.dataset.line), quantity: Number(input.value) }))
    .filter((it) => it.quantity > 0);

  if (items.length === 0) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "أدخل كمية إرجاع لسطر واحد على الأقل.";
    return;
  }

  try {
    const updated = await api(`/api/v1/organizations/${state.orgId}/pos/sales/${state.currentReturnSale.id}/return-items`, {
      method: "POST",
      body: JSON.stringify({
        reason: document.getElementById("return-reason").value || "غير محدد",
        items,
      }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.textContent = `تم الإرجاع الجزئي بنجاح — الحالة الآن: ${updated.status === "RETURNED" ? "مُرجَعة بالكامل" : "مُرجَعة جزئيًا"}`;
    document.getElementById("return-search-btn").click();
    loadDashboard();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الإرجاع: " + err.message;
  }
});

document.getElementById("return-full-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("return-result");
  try {
    await api(`/api/v1/organizations/${state.orgId}/pos/sales/${state.currentReturnSale.id}/return`, {
      method: "POST",
      body: JSON.stringify({ reason: document.getElementById("return-reason").value || "غير محدد" }),
    });
    resultEl.style.color = "#0F3D3E";
    resultEl.textContent = "تم إرجاع العملية بالكامل بنجاح.";
    document.getElementById("return-sale-panel").hidden = true;
    loadDashboard();
  } catch (err) {
    resultEl.style.color = "#A3432F";
    resultEl.textContent = "فشل الإرجاع: " + err.message;
  }
});
