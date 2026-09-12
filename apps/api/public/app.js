const state = {
  token: localStorage.getItem("mizan_token") || null,
  orgId: localStorage.getItem("mizan_org") || null,
  periodId: null,
  customers: [],
  products: [],
  posCatalog: [],
  posCart: [],
  posCategory: "all",
  posPayment: "CASH",
  receiptTemplate: "thermal",
  organization: null,
};

const money = new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => (toast.hidden = true), 2600);
}

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
    "pos-invoices": "سجل فواتير نقطة البيع",
    shift: "الوردية",
    returns: "الإرجاع",
    customers: "العملاء",
    inventory: "المخزون",
    purchases: "المشتريات",
    assets: "الأصول الثابتة",
    reports: "التقارير",
    accounts: "دليل الحسابات",
    settings: "إعدادات المنشأة",
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
  if (name === "pos-invoices") loadPosInvoices();
  if (name === "settings") loadOrganizationSettings();
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

async function loadDashboard() {
  const periodId = await findAnOpenPeriodId();
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
    body: JSON.stringify({
      name,
      vatNumber: document.getElementById("customer-vat").value.trim() || undefined,
      crNumber: document.getElementById("customer-cr").value.trim() || undefined,
      phone: document.getElementById("customer-phone").value.trim() || undefined,
      email: document.getElementById("customer-email").value.trim() || undefined,
      city: document.getElementById("customer-city").value.trim() || undefined,
      district: document.getElementById("customer-district").value.trim() || undefined,
      streetName: document.getElementById("customer-street").value.trim() || undefined,
      buildingNumber: document.getElementById("customer-building").value.trim() || undefined,
      postalZone: document.getElementById("customer-postal").value.trim() || undefined,
      countryCode: "SA",
    }),
  });
  e.currentTarget.reset();
  await loadCustomers();
});

async function loadCustomers() {
  state.customers = await api(`/api/v1/organizations/${state.orgId}/customers`);
  const tbody = document.getElementById("customers-table-body");
  tbody.innerHTML = state.customers
    .map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.vatNumber || "—")}</td><td>${escapeHtml(c.phone || "—")}</td><td>${escapeHtml(c.city || "—")}</td></tr>`)
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

// ---------- نقطة البيع — تجربة تشغيلية كاملة ----------
const DEMO_POS_PRODUCTS = [
  { id: "demo-water", sku: "DEMO-001", name: "مياه نقية 600 مل", unit: "حبة", sellingPrice: 2, taxCode: "STANDARD", category: "drinks", image: "/assets/products/water.webp", isDemo: true },
  { id: "demo-coffee", sku: "DEMO-002", name: "قهوة عربية وسط 250 جم", unit: "كيس", sellingPrice: 18, taxCode: "STANDARD", category: "drinks", image: "/assets/products/coffee.webp", isDemo: true },
  { id: "demo-tea", sku: "DEMO-003", name: "شاي أسود فاخر 100 كيس", unit: "علبة", sellingPrice: 14, taxCode: "STANDARD", category: "drinks", image: "/assets/products/tea.webp", isDemo: true },
  { id: "demo-yogurt", sku: "DEMO-004", name: "زبادي كامل الدسم 170 جم", unit: "حبة", sellingPrice: 3, taxCode: "STANDARD", category: "food", image: "/assets/products/yogurt.webp", isDemo: true },
  { id: "demo-chocolate", sku: "DEMO-005", name: "شوكولاتة بالحليب 45 جم", unit: "حبة", sellingPrice: 7.5, taxCode: "STANDARD", category: "food", image: "/assets/products/chocolate.webp", isDemo: true },
  { id: "demo-cleaner", sku: "DEMO-006", name: "منظف أسطح 1 لتر", unit: "عبوة", sellingPrice: 12, taxCode: "STANDARD", category: "home", image: "/assets/products/cleaner.webp", isDemo: true },
  { id: "demo-water-large", sku: "DEMO-007", name: "مياه نقية 1.5 لتر", unit: "حبة", sellingPrice: 3, taxCode: "STANDARD", category: "drinks", image: "/assets/products/water.webp", isDemo: true },
  { id: "demo-cleaner-large", sku: "DEMO-008", name: "منظف ملابس 3 لتر", unit: "عبوة", sellingPrice: 32, taxCode: "STANDARD", category: "home", image: "/assets/products/cleaner.webp", isDemo: true },
];

function productImage(product, index = 0) {
  if (product.image) return product.image;
  const images = ["water", "coffee", "tea", "yogurt", "chocolate", "cleaner"];
  return `/assets/products/${images[index % images.length]}.webp`;
}

function orderedCatalog(products) {
  const saved = JSON.parse(localStorage.getItem("mizan_pos_order") || "[]");
  return [...products].sort((a, b) => {
    const ai = saved.indexOf(a.id);
    const bi = saved.indexOf(b.id);
    return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
  });
}

async function loadPosView() {
  if (!state.customers.length) await loadCustomers();
  document.getElementById("pos-customer").innerHTML = `<option value="">عميل نقدي</option>${state.customers.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}`;
  const grid = document.getElementById("pos-product-grid");
  grid.setAttribute("aria-busy", "true");
  try {
    const realProducts = await api(`/api/v1/organizations/${state.orgId}/products`);
    state.products = realProducts;
    const normalized = realProducts.map((p, index) => ({
      ...p,
      sellingPrice: Number(p.sellingPrice),
      unit: p.unit || "حبة",
      category: "all",
      image: productImage(p, index),
      isDemo: false,
    }));
    state.posCatalog = orderedCatalog(normalized.length ? normalized : DEMO_POS_PRODUCTS);
  } catch (err) {
    state.posCatalog = orderedCatalog(DEMO_POS_PRODUCTS);
    showToast("تعذّر تحميل المخزون؛ تم فتح كتالوج العرض");
  } finally {
    grid.removeAttribute("aria-busy");
  }
  renderProductGrid();
  renderCart();
  requestAnimationFrame(() => document.getElementById("pos-search-input").focus());
}

function renderProductGrid() {
  const query = document.getElementById("pos-search-input").value.trim().toLowerCase();
  const products = state.posCatalog.filter((p) => {
    const matchesQuery = !query || p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query);
    const matchesCategory = state.posCategory === "all" || p.category === state.posCategory || !p.isDemo;
    return matchesQuery && matchesCategory;
  });
  const grid = document.getElementById("pos-product-grid");
  document.getElementById("catalog-count").textContent = `${products.length} صنف`;
  document.getElementById("pos-empty-products").hidden = products.length > 0;
  grid.hidden = products.length === 0;
  grid.innerHTML = products.map((p) => {
    const index = state.posCatalog.findIndex((item) => item.id === p.id);
    return `<button type="button" class="product-card" draggable="true" data-product-id="${escapeHtml(p.id)}" aria-label="إضافة ${escapeHtml(p.name)} إلى السلة">
      <i class="ri-draggable drag-grip" aria-hidden="true"></i>
      ${p.isDemo ? '<span class="demo-label">تجريبي</span>' : ""}
      <img src="${escapeHtml(productImage(p, index))}" alt="" width="180" height="180" loading="lazy" />
      <strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.unit)} · ${escapeHtml(p.sku)}</small>
      <span class="price">${money.format(Number(p.sellingPrice))} ر.س</span><span class="stock">متاح</span>
    </button>`;
  }).join("");

  grid.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", () => addProductToCart(card.dataset.productId));
    card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", card.dataset.productId); card.classList.add("dragging"); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromId = event.dataTransfer.getData("text/plain");
      reorderProducts(fromId, card.dataset.productId);
    });
  });
}

function reorderProducts(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const from = state.posCatalog.findIndex((p) => p.id === fromId);
  const to = state.posCatalog.findIndex((p) => p.id === toId);
  if (from < 0 || to < 0) return;
  const [moved] = state.posCatalog.splice(from, 1);
  state.posCatalog.splice(to, 0, moved);
  localStorage.setItem("mizan_pos_order", JSON.stringify(state.posCatalog.map((p) => p.id)));
  renderProductGrid();
  showToast("تم حفظ ترتيب الأصناف");
}

function addProductToCart(productId) {
  const product = state.posCatalog.find((p) => p.id === productId);
  if (!product) return;
  const line = state.posCart.find((item) => item.id === product.id);
  if (line) line.quantity += 1;
  else state.posCart.push({ ...product, quantity: 1 });
  renderCart();
}

function updateCartItem(productId, action) {
  const index = state.posCart.findIndex((item) => item.id === productId);
  if (index < 0) return;
  if (action === "remove") state.posCart.splice(index, 1);
  if (action === "increase") state.posCart[index].quantity += 1;
  if (action === "decrease") {
    state.posCart[index].quantity -= 1;
    if (state.posCart[index].quantity <= 0) state.posCart.splice(index, 1);
  }
  renderCart();
}

function cartTotals() {
  return state.posCart.reduce((totals, line) => {
    const net = line.quantity * Number(line.sellingPrice);
    const tax = line.taxCode === "STANDARD" ? net * 0.15 : 0;
    totals.subtotal += net;
    totals.tax += tax;
    totals.total += net + tax;
    return totals;
  }, { subtotal: 0, tax: 0, total: 0 });
}

function renderCart() {
  const lines = document.getElementById("pos-cart-lines");
  const empty = document.getElementById("pos-empty-cart");
  const count = state.posCart.reduce((sum, line) => sum + line.quantity, 0);
  document.getElementById("cart-count").textContent = count;
  empty.hidden = state.posCart.length > 0;
  lines.hidden = state.posCart.length === 0;
  lines.innerHTML = state.posCart.map((line) => `<div class="cart-line">
    <img src="${escapeHtml(productImage(line))}" alt="" width="48" height="48" />
    <div class="cart-line-info"><strong>${escapeHtml(line.name)}</strong><small>${money.format(Number(line.sellingPrice))} ر.س × ${line.quantity}</small></div>
    <div class="qty-control"><button type="button" data-cart-action="decrease" data-product-id="${escapeHtml(line.id)}" aria-label="تقليل الكمية">−</button><b>${line.quantity}</b><button type="button" data-cart-action="increase" data-product-id="${escapeHtml(line.id)}" aria-label="زيادة الكمية">+</button></div>
    <div class="cart-line-total"><span>${money.format(line.quantity * Number(line.sellingPrice))} ر.س</span><button type="button" data-cart-action="remove" data-product-id="${escapeHtml(line.id)}"><i class="ri-delete-bin-line"></i> حذف</button></div>
  </div>`).join("");
  lines.querySelectorAll("[data-cart-action]").forEach((button) => button.addEventListener("click", () => updateCartItem(button.dataset.productId, button.dataset.cartAction)));
  const totals = cartTotals();
  document.getElementById("pos-subtotal").textContent = `${money.format(totals.subtotal)} ر.س`;
  document.getElementById("pos-tax-total").textContent = `${money.format(totals.tax)} ر.س`;
  document.getElementById("pos-grand-total").textContent = `${money.format(totals.total)} ر.س`;
  document.getElementById("pos-checkout").disabled = state.posCart.length === 0;
  document.getElementById("hold-sale").disabled = state.posCart.length === 0;
}

document.getElementById("pos-search-input").addEventListener("input", renderProductGrid);
document.querySelectorAll(".category-pill").forEach((button) => button.addEventListener("click", () => {
  state.posCategory = button.dataset.category;
  document.querySelectorAll(".category-pill").forEach((item) => item.classList.toggle("active", item === button));
  renderProductGrid();
}));
document.querySelectorAll("#payment-methods button").forEach((button) => button.addEventListener("click", () => {
  state.posPayment = button.dataset.payment;
  document.querySelectorAll("#payment-methods button").forEach((item) => item.classList.toggle("active", item === button));
}));
document.querySelectorAll("#receipt-templates button").forEach((button) => button.addEventListener("click", () => {
  state.receiptTemplate = button.dataset.template;
  document.querySelectorAll("#receipt-templates button").forEach((item) => item.classList.toggle("active", item === button));
}));
document.getElementById("clear-cart").addEventListener("click", () => { state.posCart = []; renderCart(); showToast("تم إفراغ السلة"); });
document.getElementById("hold-sale").addEventListener("click", () => {
  localStorage.setItem(`mizan_held_sale_${state.orgId}`, JSON.stringify(state.posCart));
  state.posCart = [];
  renderCart();
  showToast("تم تعليق الفاتورة وحفظها على هذا الجهاز");
});

document.getElementById("pos-checkout").addEventListener("click", async () => {
  const resultEl = document.getElementById("pos-result");
  if (!state.posCart.length) return;
  const periodId = await findAnOpenPeriodId();
  if (!periodId) {
    resultEl.textContent = "تعذّر تحديد الفترة المحاسبية.";
    return;
  }

  const lines = state.posCart.map((line) => ({ description: line.name, quantity: line.quantity, unitPrice: Number(line.sellingPrice), taxCode: line.taxCode, ...(line.isDemo ? {} : { productId: line.id }) }));

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
        tenders: [{ method: state.posPayment, amount: Number(total.toFixed(2)) }],
        idempotencyKey: `web-pos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...(document.getElementById("pos-customer").value ? { customerId: document.getElementById("pos-customer").value } : {}),
        ...(state.shiftId ? { shiftId: state.shiftId } : {}),
      }),
    });
    resultEl.style.color = "#168a61";
    resultEl.textContent = `تم تسجيل البيع بنجاح — ${sale.total} ر.س`;
    state.posCart = [];
    renderCart();
    await openPosReceipt(sale.id);
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
function closeReceipt() {
  const overlay = document.getElementById("receipt-overlay");
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
}

function closeQuickProduct() {
  const overlay = document.getElementById("quick-product-overlay");
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
}

document.getElementById("receipt-close").addEventListener("click", closeReceipt);
document.getElementById("receipt-print").addEventListener("click", () => window.print());
document.getElementById("receipt-overlay").addEventListener("click", (event) => { if (event.target.id === "receipt-overlay") closeReceipt(); });

function renderReceiptHtml(r) {
  const rows = r.lines
    .map(
      (l) => `<tr><td>${escapeHtml(l.description)}</td><td class="num">${escapeHtml(l.quantity)}</td><td class="num">${Number(l.unitPrice).toFixed(2)}</td><td class="num">${escapeHtml(l.lineTotal)}</td></tr>`,
    )
    .join("");
  const dt = new Date(r.issuedAt).toLocaleString("ar-SA", { hour12: true });
  return `
    <div class="rcpt-biz-name">${escapeHtml(r.sellerName)}</div>
    <div class="rcpt-biz-meta">${r.sellerVatNumber ? "الرقم الضريبي: " + escapeHtml(r.sellerVatNumber) : ""}</div>
    ${r.sellerAddress ? `<div class="rcpt-biz-meta">${escapeHtml(r.sellerAddress)}</div>` : ""}
    ${r.sellerPhone || r.sellerEmail ? `<div class="rcpt-biz-meta">${escapeHtml([r.sellerPhone, r.sellerEmail].filter(Boolean).join(" · "))}</div>` : ""}
    <div class="rcpt-title-band">فاتورة ضريبية</div>
    <div class="rcpt-meta-row"><span>رقم المستند</span><span class="val">${escapeHtml(r.documentNumber)}</span></div>
    <div class="rcpt-meta-row"><span>التاريخ والوقت</span><span class="val">${dt}</span></div>
    ${r.customer ? `<div class="rcpt-customer"><strong>بيانات العميل</strong><span>${escapeHtml(r.customer.name)}</span>${r.customer.vatNumber ? `<span>الرقم الضريبي: ${escapeHtml(r.customer.vatNumber)}</span>` : ""}${r.customer.address ? `<span>${escapeHtml(r.customer.address)}</span>` : ""}</div>` : ""}
    <table class="rcpt-table">
      <thead><tr><th>الصنف</th><th class="num">كمية</th><th class="num">سعر</th><th class="num">الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="rcpt-totals-row"><span>الإجمالي قبل الضريبة</span><span class="amt">${escapeHtml(r.subtotal)} ر.س</span></div>
    <div class="rcpt-totals-row"><span>ضريبة القيمة المضافة</span><span class="amt">${escapeHtml(r.taxTotal)} ر.س</span></div>
    <div class="rcpt-totals-row grand"><span>الإجمالي المستحق</span><span class="amt">${escapeHtml(r.total)} ر.س</span></div>
    <div class="rcpt-payment">${escapeHtml(r.paymentSummary)}</div>
    <div class="rcpt-qr-wrap">
      <img src="${escapeHtml(r.qrCodeDataUrl)}" alt="رمز الاستجابة السريعة للفاتورة الضريبية" />
      <div class="rcpt-qr-caption">رمز الاستجابة السريعة لضريبة القيمة المضافة — نموذج المرحلة الأولى</div>
    </div>
    ${r.invoiceFooter ? `<div class="rcpt-footer">${escapeHtml(r.invoiceFooter)}</div>` : ""}
  `;
}

// ---------- سجل فواتير نقطة البيع ----------
async function loadPosInvoices(query = "") {
  const sales = await api(`/api/v1/organizations/${state.orgId}/pos/sales${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  if (!state.customers.length) await loadCustomers();
  const customerNames = new Map(state.customers.map((c) => [c.id, c.name]));
  const body = document.getElementById("pos-invoices-body");
  document.getElementById("pos-invoices-empty").hidden = sales.length > 0;
  body.innerHTML = sales.map((sale) => `<tr>
    <td class="num">${escapeHtml(sale.invoiceNumber || sale.id.slice(0, 8))}</td>
    <td>${new Date(sale.soldAt).toLocaleString("ar-SA")}</td>
    <td>${escapeHtml(sale.customerName || customerNames.get(sale.customerId) || "عميل نقدي")}</td>
    <td>${escapeHtml(sale.lines.map((line) => line.description).join("، "))}</td>
    <td class="num">${escapeHtml(sale.total)} ر.س</td><td>${sale.status === "COMPLETED" ? "مكتملة" : "مرتجعة"}</td>
    <td><button class="ghost-btn view-pos-invoice" data-sale-id="${escapeHtml(sale.id)}">عرض وطباعة</button></td>
  </tr>`).join("");
  body.querySelectorAll(".view-pos-invoice").forEach((button) => button.addEventListener("click", () => openPosReceipt(button.dataset.saleId)));
}

let invoiceSearchTimer;
document.getElementById("pos-invoice-search").addEventListener("input", (event) => {
  clearTimeout(invoiceSearchTimer);
  invoiceSearchTimer = setTimeout(() => loadPosInvoices(event.target.value.trim()), 250);
});

// ---------- إعدادات المنشأة ----------
async function loadOrganizationSettings() {
  state.organization = await api(`/api/v1/organizations/${state.orgId}`);
  const o = state.organization;
  const fields = { "org-legal-name": o.legalNameAr, "org-commercial-name": o.commercialName, "org-vat": o.vatNumber, "org-cr": o.crNumber, "org-phone": o.phone, "org-email": o.email, "org-city": o.city, "org-district": o.district, "org-street": o.streetName, "org-building": o.buildingNumber, "org-postal": o.postalZone, "org-footer": o.invoiceFooter };
  Object.entries(fields).forEach(([id, value]) => { document.getElementById(id).value = value || ""; });
  document.getElementById("org-template").value = o.defaultReceiptTemplate || "thermal";
  document.getElementById("org-require-shift").checked = Boolean(o.requireShiftForPosSale);
}

document.getElementById("organization-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = document.getElementById("organization-settings-result");
  try {
    const body = {
      legalNameAr: document.getElementById("org-legal-name").value.trim(), commercialName: document.getElementById("org-commercial-name").value.trim() || undefined,
      vatNumber: document.getElementById("org-vat").value.trim() || undefined, crNumber: document.getElementById("org-cr").value.trim() || undefined,
      phone: document.getElementById("org-phone").value.trim() || undefined, email: document.getElementById("org-email").value.trim() || undefined,
      city: document.getElementById("org-city").value.trim() || undefined, district: document.getElementById("org-district").value.trim() || undefined,
      streetName: document.getElementById("org-street").value.trim() || undefined, buildingNumber: document.getElementById("org-building").value.trim() || undefined,
      postalZone: document.getElementById("org-postal").value.trim() || undefined, countryCode: "SA",
      invoiceFooter: document.getElementById("org-footer").value.trim() || undefined, defaultReceiptTemplate: document.getElementById("org-template").value,
      requireShiftForPosSale: document.getElementById("org-require-shift").checked,
    };
    state.organization = await api(`/api/v1/organizations/${state.orgId}/settings`, { method: "PATCH", body: JSON.stringify(body) });
    state.receiptTemplate = state.organization.defaultReceiptTemplate || "thermal";
    result.textContent = "تم حفظ البيانات بنجاح"; result.style.color = "#168a61"; showToast("تم تحديث بيانات المنشأة والفاتورة");
  } catch (err) { result.textContent = "تعذّر الحفظ: " + err.message; result.style.color = "#b54837"; }
});

async function openPosReceipt(saleId) {
  const receipt = await api(`/api/v1/organizations/${state.orgId}/pos/sales/${saleId}/receipt`);
  document.getElementById("receipt-content").innerHTML = renderReceiptHtml(receipt);
  const paper = document.getElementById("receipt-paper");
  paper.className = `receipt-box ${state.receiptTemplate}`;
  const overlay = document.getElementById("receipt-overlay");
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("receipt-close").focus();
}

async function openInvoiceReceipt(invoiceId) {
  const receipt = await api(`/api/v1/organizations/${state.orgId}/sales/invoices/${invoiceId}/receipt`);
  document.getElementById("receipt-content").innerHTML = renderReceiptHtml(receipt);
  const overlay = document.getElementById("receipt-overlay");
  document.getElementById("receipt-paper").className = "receipt-box a4";
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
}

// ---------- إضافة صنف سريع ----------
document.getElementById("quick-product").addEventListener("click", () => {
  const overlay = document.getElementById("quick-product-overlay");
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.getElementById("quick-product-name").focus();
});
document.getElementById("quick-product-close").addEventListener("click", closeQuickProduct);
document.getElementById("quick-product-overlay").addEventListener("click", (event) => { if (event.target.id === "quick-product-overlay") closeQuickProduct(); });
document.getElementById("quick-product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = document.getElementById("quick-product-result");
  const submit = event.submitter;
  submit.disabled = true;
  result.textContent = "جارٍ حفظ الصنف...";
  try {
    const product = await api(`/api/v1/organizations/${state.orgId}/products`, {
      method: "POST",
      body: JSON.stringify({
        sku: document.getElementById("quick-product-sku").value.trim(),
        name: document.getElementById("quick-product-name").value.trim(),
        unit: document.getElementById("quick-product-unit").value,
        sellingPrice: Number(document.getElementById("quick-product-price").value),
        taxCode: document.getElementById("quick-product-tax").value,
      }),
    });
    const normalized = { ...product, sellingPrice: Number(product.sellingPrice), category: "all", image: productImage(product, state.posCatalog.length), isDemo: false };
    state.posCatalog.unshift(normalized);
    addProductToCart(normalized.id);
    renderProductGrid();
    event.currentTarget.reset();
    closeQuickProduct();
    showToast("تم حفظ الصنف وإضافته إلى السلة");
  } catch (err) {
    result.style.color = "#b54837";
    result.textContent = "تعذّر حفظ الصنف: " + err.message;
  } finally {
    submit.disabled = false;
  }
});

// ---------- اختصارات لوحة المفاتيح والقائمة المتجاوبة ----------
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeReceipt(); closeQuickProduct(); }
  if (event.key === "F2" && !document.getElementById("view-pos").hidden) { event.preventDefault(); document.getElementById("pos-search-input").focus(); }
  if (event.key === "F5" && !document.getElementById("view-pos").hidden && state.posCart.length) { event.preventDefault(); document.getElementById("pos-checkout").click(); }
});

const sidebar = document.querySelector(".sidebar");
const mobileBackdrop = document.getElementById("mobile-backdrop");
function closeMobileMenu() { sidebar.classList.remove("open"); mobileBackdrop.hidden = true; }
document.getElementById("mobile-menu").addEventListener("click", () => { sidebar.classList.toggle("open"); mobileBackdrop.hidden = !sidebar.classList.contains("open"); });
mobileBackdrop.addEventListener("click", closeMobileMenu);
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", closeMobileMenu));

// Defensive reset: prevents a stale/cached receipt state from blocking login.
closeReceipt();
closeQuickProduct();

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
