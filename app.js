const API_BASE_URL = "https://app.tatapower.solar";
const _origFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  if (typeof input === "string" && input.startsWith("/api")) {
    return _origFetch(API_BASE_URL + input, { ...init, credentials: "include" });
  }
  return _origFetch(input, init);
};

const state = {
  user: null,
  business: null,
  page: "dashboard",
  authMode: "login",
  clients: [],
  products: [],
  invoices: [],
  installPrompt: null,
  search: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const money = (value) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: state.business?.currency || "INR", maximumFractionDigits: 2,
}).format(Number(value || 0));
const shortDate = (value) => value ? new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric",
}).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : "—";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};

async function api(path, options = {}) {
  const { headers = {}, ...fetchOptions } = options;
  const response = await fetch(path, {
    ...fetchOptions,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...headers },
  });
  let payload = {};
  if(response.status!==204) {
    try { payload=await response.json(); }
    catch { throw new Error("The server returned an unreadable response."); }
  }
  if (!response.ok) {
    const error=new Error(payload.error || `Request failed (${response.status}).`);
    error.status=response.status;
    throw error;
  }
  return payload;
}

function toast(message, kind = "success") {
  const root = $("#toast-root");
  const item = document.createElement("div");
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  root.append(item);
  window.setTimeout(() => item.remove(), 3400);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === "register";
  $("#auth-title").textContent = registering ? "Start with a clear view" : "Welcome back";
  $("#auth-subtitle").textContent = registering
    ? "Create your account and set up your business workspace."
    : "Sign in to pick up where you left off.";
  $("#auth-name-wrap").hidden = !registering;
  $("#auth-business-wrap").hidden = !registering;
  $("#auth-name").required = registering;
  $("#auth-password").autocomplete = registering ? "new-password" : "current-password";
  $("#auth-password").minLength = registering ? 10 : 1;
  $("#auth-submit");
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("selected", tab.dataset.authMode === mode));
  $(".auth-submit").innerHTML = registering ? 'Create workspace <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
  $("#auth-error").textContent = "";
}

function showApp(user, business) {
  state.user = user;
  state.business = business;
  $("#auth-view").hidden = true;
  $("#app-view").hidden = false;
  renderUserChip(user);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  $("#install-button").hidden = installed;
  $("#auth-install-button").hidden = installed;
  $$(".owner-only").forEach((element) => { element.hidden = user.role !== "owner"; });
  loadPage(state.page);
}

function renderUserChip(user) {
  $("#user-name").textContent = user.name.split(/\s+/)[0];
  $("#user-avatar").innerHTML = user.avatar_data
    ? `<img class="avatar-image" src="${escapeHtml(user.avatar_data)}" alt="">`
    : escapeHtml(user.name.trim().charAt(0).toUpperCase());
}

async function bootstrap() {
  try {
    const data = await api("/api/auth/me");
    if(data.user) showApp(data.user, data.business);
    else {
      $("#auth-view").hidden=false;
      $("#app-view").hidden=true;
    }
    if (new URLSearchParams(location.search).get("new") === "invoice") {
      state.page = "invoices";
      await loadPage("invoices");
      openInvoiceModal();
    }
  } catch (error) {
    $("#auth-view").hidden = false;
    $("#app-view").hidden = true;
    if(error.status!==401) $("#auth-error").textContent=error.message;
  }
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $(".auth-submit");
  submit.disabled = true;
  $("#auth-error").textContent = "";
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const endpoint = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
    const me = await api("/api/auth/me");
    showApp(result.user, me.business);
  } catch (error) {
    $("#auth-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

const pageTitles = {
  dashboard: "Overview", invoices: "Invoices", clients: "Clients", items: "Items & services",
  payments: "Payments", team: "Team", settings: "Business settings",
  "solar-invoice": "Solar invoice page", profile: "My profile",
};

async function loadPage(page) {
  if (state.user?.role === "staff" && ["team", "settings"].includes(page)) page = "dashboard";
  state.page = page;
  state.search = "";
  $("#page-content").classList.toggle("solar-page", page === "solar-invoice");
  $("#current-section").textContent = pageTitles[page];
  $$(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  $("#sidebar").classList.remove("sidebar-open");
  try {
    if (page === "dashboard") {
      const data = await api("/api/dashboard");
      renderDashboard(data);
    } else if (page === "clients") {
      state.clients = await api("/api/clients");
      renderClients();
    } else if (page === "items") {
      state.products = await api("/api/products");
      renderProducts();
    } else if (page === "invoices") {
      [state.clients, state.products, state.invoices] = await Promise.all([
        api("/api/clients"), api("/api/products"), api("/api/invoices"),
      ]);
      renderInvoices();
    } else if (page === "payments") {
      const payments = await api("/api/payments");
      renderPayments(payments);
    } else if (page === "team") {
      renderTeam(await api("/api/team"));
    } else if (page === "settings") {
      state.business = await api("/api/settings");
      renderSettings(state.business);
    } else if (page === "profile") {
      renderProfile();
    } else if (page === "solar-invoice") {
      renderSolarInvoicePage();
    }
  } catch (error) {
    $("#page-content").innerHTML = `<section class="empty-state"><div class="empty-icon">!</div><h2>Could not load this page</h2><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-action="reload-page">Try again</button></section>`;
  }
}

function pageHeader(title, description, action = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${escapeHtml(state.business?.name || "YOUR WORKSPACE")}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function amountCard(label, value, note, icon, tone = "") {
  return `<article class="metric-card ${tone}"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><strong>${value}</strong><small>${note}</small></article>`;
}

function renderDashboard(data) {
  const max = Math.max(1, ...data.months.map((month) => Number(month.amount)));
  const months = data.months.map((month) => `<div class="chart-column"><div class="chart-amount">${money(month.amount)}</div><div class="chart-track"><span style="height:${Math.max(4, Number(month.amount) / max * 100)}%"></span></div><small>${new Intl.DateTimeFormat("en",{month:"short"}).format(new Date(`${month.month}-01T00:00:00`))}</small></div>`).join("");
  const recent = data.recent.length ? data.recent.map((invoice) => `<tr>
    <td><strong>${escapeHtml(invoice.number)}</strong></td><td>${escapeHtml(invoice.client_name)}</td>
    <td>${shortDate(invoice.issue_date)}</td><td>${statusPill(invoice.status)}</td><td class="amount-cell">${money(invoice.total)}</td>
    <td><button class="table-action" data-action="print-invoice" data-id="${invoice.id}" title="Print invoice">↗</button></td>
  </tr>`).join("") : `<tr><td class="table-empty" colspan="6">Your first invoice will show up here.</td></tr>`;
  $("#page-content").innerHTML = `${pageHeader("A brighter view of business","Here’s what’s happening with your billing today.",'<button class="button button-primary" data-action="new-invoice">＋ New invoice</button>')}
    <div class="metric-grid">
      ${amountCard("Total billed",money(data.billed),"Across all invoices","↗","metric-brand")}
      ${amountCard("Collected",money(data.collected),"Payments received","✓","")}
      ${amountCard("Outstanding",money(data.due),"Still to be collected","◷","metric-warm")}
      ${amountCard("Active clients",data.clients,"In your workspace","♙","")}
    </div>
    <div class="dashboard-grid">
      <section class="panel chart-panel"><div class="panel-heading"><div><h2>Revenue over time</h2><p>Invoice totals for the last six months</p></div><span class="panel-tag">6 months</span></div>
        <div class="chart">${months || '<div class="chart-empty">New invoices will build your revenue chart.</div>'}</div>
      </section>
      <section class="panel insight-panel"><div class="insight-mark">✦</div><div class="eyebrow">YOUR NEXT STEP</div><h2>Make getting paid<br>feel effortless.</h2><p>Create a polished invoice and keep every payment in one calm, clear place.</p><button class="button button-light" data-action="new-invoice">Create an invoice <span>→</span></button></section>
    </div>
    <section class="panel table-panel"><div class="panel-heading"><div><h2>Recent invoices</h2><p>Your latest billing activity</p></div><button class="text-button" data-page="invoices">All invoices <span>→</span></button></div>
      <div class="table-scroll"><table><thead><tr><th>INVOICE</th><th>CLIENT</th><th>ISSUED</th><th>STATUS</th><th class="amount-cell">TOTAL</th><th></th></tr></thead><tbody>${recent}</tbody></table></div>
    </section>`;
}

function statusPill(status) {
  const value = ["paid", "partial", "unpaid"].includes(status) ? status : "unpaid";
  const label = value === "paid" ? "Paid" : value === "partial" ? "Part paid" : "Unpaid";
  return `<span class="status-pill status-${value}"><i></i>${label}</span>`;
}

function tableShell(headers, rows, empty, searchPlaceholder = "Search") {
  const heading = headers.map((header) => `<th>${header}</th>`).join("");
  return `<div class="table-tools"><label class="search-box"><span>⌕</span><input id="table-search" type="search" placeholder="${searchPlaceholder}" autocomplete="off"></label></div>
    <div class="table-scroll"><table><thead><tr>${heading}</tr></thead><tbody>${rows || `<tr><td class="table-empty" colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
}

function renderClients() {
  const rows = state.clients.map((client) => `<tr data-searchable="${escapeHtml(`${client.name} ${client.email} ${client.phone}`.toLowerCase())}">
    <td><div class="person-cell"><span class="person-avatar">${escapeHtml(client.name.charAt(0).toUpperCase())}</span><strong>${escapeHtml(client.name)}</strong></div></td>
    <td>${escapeHtml(client.email || "—")}</td><td>${escapeHtml(client.phone || "—")}</td>
    <td>${escapeHtml(client.state || "—")}</td><td>${escapeHtml(client.gstin || "—")}</td>
    <td class="row-actions"><button class="table-action" data-action="edit-client" data-id="${client.id}" title="Edit client">✎</button>
      ${state.user.role==="owner"?`<button class="table-action danger-action" data-action="remove-client" data-id="${client.id}" title="Delete client">×</button>`:""}</td>
  </tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Clients","Good work starts with good relationships.",'<button class="button button-primary" data-action="new-client">＋ Add client</button>')}
    <section class="panel table-panel">${tableShell(["CLIENT","EMAIL","PHONE","STATE","GSTIN",""],rows,"No clients yet. Add your first client to get started.","Search clients")}</section>`;
}

function renderProducts() {
  const rows = state.products.map((product) => `<tr data-searchable="${escapeHtml(`${product.name} ${product.description}`.toLowerCase())}">
    <td><div class="product-cell"><span class="product-icon">◇</span><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || "No description")}</small></div></div></td>
    <td>${escapeHtml(product.unit)}</td><td>${Number(product.tax_rate)}%</td><td class="amount-cell">${money(product.price)}</td>
    <td class="row-actions"><button class="table-action" data-action="edit-product" data-id="${product.id}" title="Edit item">✎</button>
      ${state.user.role==="owner"?`<button class="table-action danger-action" data-action="remove-product" data-id="${product.id}" title="Delete item">×</button>`:""}</td>
  </tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Items & services","A tidy catalogue makes every invoice quicker.",'<button class="button button-primary" data-action="new-product">＋ Add item</button>')}
    <section class="panel table-panel">${tableShell(["ITEM / SERVICE","UNIT","GST","PRICE",""],rows,"Your catalogue is empty. Add an item or service.","Search items")}</section>`;
}

function renderInvoices() {
  const rows = state.invoices.map((invoice) => `<tr data-searchable="${escapeHtml(`${invoice.number} ${invoice.client_name} ${invoice.status}`.toLowerCase())}">
    <td><strong>${escapeHtml(invoice.number)}</strong></td><td>${escapeHtml(invoice.client_name)}</td><td>${shortDate(invoice.issue_date)}</td>
    <td>${invoice.due_date ? shortDate(invoice.due_date) : "—"}</td><td>${statusPill(invoice.status)}</td>
    <td class="amount-cell">${money(invoice.total)}</td><td class="row-actions">
      ${invoice.status !== "paid" ? `<button class="table-action" data-action="add-payment" data-id="${invoice.id}" title="Record payment">＋</button>` : ""}
      <button class="table-action" data-action="print-invoice" data-id="${invoice.id}" title="Preview / print">↗</button>
      ${state.user.role==="owner"&&invoice.paid===0?`<button class="table-action danger-action" data-action="remove-invoice" data-id="${invoice.id}" title="Delete invoice">×</button>`:""}
    </td></tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Invoices","Every invoice, amount and payment in one place.",'<button class="button button-primary" data-action="new-invoice">＋ New invoice</button>')}
    <section class="panel table-panel">${tableShell(["INVOICE","CLIENT","ISSUED","DUE DATE","STATUS","TOTAL",""],rows,"No invoices yet. Create your first invoice.","Search invoices")}</section>`;
}

function renderPayments(payments) {
  const rows = payments.map((payment) => `<tr data-searchable="${escapeHtml(`${payment.invoice_number} ${payment.client_name} ${payment.method}`.toLowerCase())}">
    <td><strong>${escapeHtml(payment.invoice_number)}</strong></td><td>${escapeHtml(payment.client_name)}</td><td>${shortDate(payment.paid_on)}</td>
    <td>${escapeHtml(payment.method)}</td><td>${escapeHtml(payment.note || "—")}</td><td class="amount-cell amount-positive">${money(payment.amount)}</td>
  </tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Payments","A clear record of every rupee received.")}
    <section class="panel table-panel">${tableShell(["INVOICE","CLIENT","DATE","METHOD","NOTE","AMOUNT"],rows,"Payments recorded against invoices will appear here.","Search payments")}</section>`;
}

function renderTeam(users) {
  const rows = users.map((member) => `<tr><td><div class="person-cell"><span class="person-avatar">${escapeHtml(member.name.charAt(0).toUpperCase())}</span><strong>${escapeHtml(member.name)}</strong></div></td>
    <td>${escapeHtml(member.email)}</td><td><span class="role-pill">${member.role === "owner" ? "Owner" : "Billing staff"}</span></td>
    <td>${shortDate(member.created_at)}</td>${member.id !== state.user.id ? `<td><button class="table-action danger-action" data-action="remove-staff" data-id="${member.id}" title="Remove staff">×</button></td>` : "<td>—</td>"}</tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Team","Give trusted teammates access to billing.",'<button class="button button-primary" data-action="new-staff">＋ Add staff</button>')}
    <div class="callout"><span>ⓘ</span><p><strong>Billing-only access.</strong> Staff can manage clients, items, invoices and payments. Business settings and team access stay with the owner.</p></div>
    <section class="panel table-panel">${tableShell(["TEAM MEMBER","EMAIL","ACCESS","ADDED",""],rows,"You’re the only person in this workspace.","Search team")}</section>`;
}

function renderProfile() {
  const user = state.user;
  const avatar = user.avatar_data;
  $("#page-content").innerHTML = `${pageHeader("My profile","Manage your name and the photo shown with your account.")}
    <form id="profile-form" class="profile-form panel">
      <div class="panel-heading"><div><h2>Personal details</h2><p>Your photo is private to your account.</p></div></div>
      <div class="profile-form-content">
        ${field("Full name","name",user.name,"text",true)}
        <label class="field"><span>Email address</span><input value="${escapeHtml(user.email)}" type="email" disabled></label>
        <div class="field image-upload">
          <span>Profile photo</span>
          <div class="image-upload-row"><input id="profile-photo-upload" type="file" accept="image/png,image/jpeg,image/webp">
            <button class="button button-quiet button-small" type="button" data-action="clear-image" data-input="profile-photo-upload" data-remove="removePhoto">Remove image</button>
            <img id="profile-photo-upload-preview" class="image-preview profile-image-preview" src="${avatar?escapeHtml(avatar):""}" alt="Profile photo preview" ${avatar?"":"hidden"}></div>
          <input type="hidden" name="removePhoto" value="false">
          <small>PNG, JPEG or WebP, up to 256 KB.</small>
        </div>
        <div class="profile-form-footer"><span>Role: ${escapeHtml(user.role === "owner" ? "Owner" : "Billing staff")}</span><button class="button button-primary" type="submit">Save profile</button></div>
      </div>
    </form>`;
}

function renderSolarInvoicePage() {
  $("#page-content").innerHTML = `<iframe class="solar-invoice-frame" src="./solar-invoice.html" title="Solar invoice manager"></iframe>`;
}

function renderSettings(business) {
  $("#page-content").innerHTML = `${pageHeader("Business settings","The details your clients see on every invoice.")}
    <form id="settings-form" class="settings-grid">
      <section class="panel settings-panel"><div class="panel-heading"><div><h2>Business profile</h2><p>Keep your legal and contact details current.</p></div></div>
        <div class="form-grid">
          ${field("Business name","name",business.name,"text",true)}
          ${field("GSTIN","gstin",business.gstin,"text")}
          ${field("Business email","email",business.email,"email")}
          ${field("Phone","phone",business.phone,"tel")}
          ${field("State / territory","state",business.state,"text")}
          ${field("Invoice prefix","invoicePrefix",business.invoice_prefix,"text")}
          ${field("Tagline","tagline",business.tagline,"text")}
          <label class="field"><span>Currency</span><select name="currency">${currencyOptions(business.currency)}</select></label>
          <label class="field"><span>Tax mode</span><select name="taxMode"><option value="gst" ${business.tax_mode==="gst"?"selected":""}>GST (CGST / SGST or IGST)</option><option value="simple" ${business.tax_mode==="simple"?"selected":""}>Simple tax</option></select></label>
          <label class="field full-width"><span>Business address</span><textarea name="address" rows="3" placeholder="Street, city, postal code">${escapeHtml(business.address)}</textarea></label>
          <div class="field full-width settings-section-label"><strong>Payment details</strong><small>These appear on printable invoices.</small></div>
          ${field("Bank name","bankName",business.bank_name)}
          ${field("Account holder","bankAccountName",business.bank_account_name)}
          ${field("Account number","bankAccountNo",business.bank_account_no)}
          ${field("IFSC / routing code","bankIfsc",business.bank_ifsc)}
          ${field("Branch","bankBranch",business.bank_branch)}
          <label class="field full-width"><span>Invoice terms & conditions</span><textarea name="terms" rows="3" placeholder="One term per line">${escapeHtml(business.terms)}</textarea></label>
          ${imageUpload("Invoice logo",business.logo_data,"logo-upload","removeLogo")}
          ${imageUpload("Invoice stamp / signature",business.seal_data,"seal-upload","removeSeal")}
        </div><div class="settings-footer"><span>Changes apply to new invoices.</span><button class="button button-primary" type="submit">Save changes</button></div>
      </section>
      <aside class="settings-note"><div class="note-icon">✦</div><h3>Thoughtfully professional.</h3><p>Your business profile helps make every invoice feel complete and ready to send.</p><div class="settings-note-divider"></div><small>GST uses CGST + SGST for intra-state supplies and IGST for inter-state supplies.</small></aside>
    </form>`;
}

function imageUpload(label, data, inputId, removeName) {
  const previewId = `${inputId}-preview`;
  return `<div class="field full-width image-upload"><span>${label}</span>
    <div class="image-upload-row"><input id="${inputId}" type="file" accept="image/png,image/jpeg,image/webp">
      <button class="button button-quiet button-small" type="button" data-action="clear-image" data-input="${inputId}" data-remove="${removeName}">Remove image</button>
      <img id="${previewId}" class="image-preview" src="${data?escapeHtml(data):""}" alt="${label} preview" ${data?"":"hidden"}></div>
    <input type="hidden" name="${removeName}" value="false">
    <small>PNG, JPEG or WebP, up to 256 KB. This is printed on your invoices.</small></div>`;
}

function currencyOptions(selected) {
  const currencies = ["INR","USD","EUR","GBP","AED","SGD","AUD","CAD"];
  return currencies.map((currency)=>`<option value="${currency}" ${currency===selected?"selected":""}>${currency}</option>`).join("");
}

function field(label, name, value = "", type = "text", required = false) {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}></label>`;
}

function modal(title, content, submitLabel = "Save") {
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-header"><div><div class="eyebrow">BILLFORGE</div><h2 id="modal-title">${title}</h2></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close">×</button></div>
    <form id="modal-form">${content}<p id="modal-error" class="form-error" role="alert"></p>
      <div class="modal-footer"><button class="button button-quiet" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">${submitLabel}</button></div>
    </form></section></div>`;
  $("#modal-form").focus?.();
  const firstInput = $("#modal-form input, #modal-form select");
  firstInput?.focus();
}

function openClientModal(clientId = "") {
  const client=state.clients.find((item)=>item.id===clientId);
  modal(client?"Edit client":"Add a client",`${field("Client or business name","name",client?.name||"")}${field("Email address","email",client?.email||"","email")}${field("Phone number","phone",client?.phone||"","tel")}${field("GSTIN","gstin",client?.gstin||"")}${field("State / territory","state",client?.state||"")}${`<label class="field"><span>Address</span><textarea name="address" rows="2">${escapeHtml(client?.address||"")}</textarea></label>`}`,client?"Save changes":"Save");
  $("#modal-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    try { await api(client?`/api/clients/${client.id}`:"/api/clients",{method:client?"PATCH":"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))}); closeModal(); toast(client?"Client updated.":"Client added."); await loadPage("clients"); }
    catch(error) { showModalError(error); }
  });
}

function openProductModal(productId = "") {
  const product=state.products.find((item)=>item.id===productId);
  modal(product?"Edit item or service":"Add an item or service",`${field("Name","name",product?.name||"")}${`<label class="field"><span>Description</span><textarea name="description" rows="2">${escapeHtml(product?.description||"")}</textarea></label>`}
    <div class="form-grid form-grid-tight">${field("Unit price","price",product?.price??"0","number",true)}${field("GST rate (%)","taxRate",product?.tax_rate??"18","number")}${field("Unit","unit",product?.unit||"unit")}${field("HSN / SAC code","hsn",product?.hsn||"")}</div>`,product?"Save changes":"Save");
  $("#modal-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const body=Object.fromEntries(new FormData(event.currentTarget).entries());
    body.price=Number(body.price);body.taxRate=Number(body.taxRate);
    try { await api(product?`/api/products/${product.id}`:"/api/products",{method:product?"PATCH":"POST",body:JSON.stringify(body)});closeModal();toast(product?"Item updated.":"Item added to your catalogue.");await loadPage("items"); }
    catch(error) { showModalError(error); }
  });
}

let draftItems = [];

function openInvoiceModal() {
  if (!state.clients.length) {
    toast("Add a client before creating an invoice.","error");
    loadPage("clients");
    return;
  }
  if (!state.products.length) {
    toast("Add an item or service before creating an invoice.","error");
    loadPage("items");
    return;
  }
  draftItems = [];
  const clientOptions = state.clients.map((client)=>`<option value="${client.id}">${escapeHtml(client.name)}</option>`).join("");
  const productOptions = state.products.map((product)=>`<option value="${product.id}">${escapeHtml(product.name)} · ${money(product.price)}</option>`).join("");
  modal("Create an invoice",`<label class="field"><span>Bill to</span><select name="clientId" required>${clientOptions}</select></label>
    <div class="form-grid form-grid-tight">${field("Issue date","issueDate",today(),"date")}${field("Due date","dueDate","","date")}</div>
    <div class="invoice-items-heading"><div><strong>Items</strong><small>Prices and GST from your catalogue</small></div><label class="add-item-select"><span class="sr-only">Choose item</span><select id="draft-product">${productOptions}</select></label><button class="button button-secondary button-small" type="button" data-action="add-draft-item">Add</button></div>
    <div id="draft-item-list" class="draft-item-list"><p class="draft-empty">Add an item or service to begin.</p></div>
    <div class="form-grid form-grid-tight invoice-discount-fields">
      <label class="field"><span>Discount type</span><select name="discountType" id="discount-type"><option value="percent">Percentage</option><option value="flat">Fixed amount</option></select></label>
      ${field("Discount value","discountValue","0","number")}
    </div>
    <label class="field invoice-tax-mode"><span>Tax calculation</span><select name="taxMode"><option value="${state.business?.tax_mode||"gst"}">${state.business?.tax_mode==="simple"?"Simple tax":"GST"}</option><option value="${state.business?.tax_mode==="simple"?"gst":"simple"}">${state.business?.tax_mode==="simple"?"GST":"Simple tax"}</option></select></label>
    <div id="draft-totals" class="draft-totals"></div>
    <label class="field"><span>Note (optional)</span><textarea name="notes" rows="2" placeholder="Payment terms or a thank-you note"></textarea></label>`);
  $("#modal-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    if(!draftItems.length){showModalError(new Error("Add at least one invoice item."));return;}
    const body=Object.fromEntries(new FormData(event.currentTarget).entries());
    body.items=draftItems;
    try { await api("/api/invoices",{method:"POST",body:JSON.stringify(body)});closeModal();toast("Invoice created.");await loadPage("invoices"); }
    catch(error) { showModalError(error); }
  });
  renderDraftItems();
}

function renderDraftItems() {
  const list=$("#draft-item-list");
  if(!list) return;
  list.innerHTML=draftItems.length?draftItems.map((item,index)=>`<div class="draft-line"><span>${escapeHtml(item.name)}<small>${item.quantity} × ${money(item.price)} · GST ${item.taxRate}%</small></span><strong>${money(item.quantity*item.price*(1+item.taxRate/100))}</strong><button type="button" class="table-action danger-action" data-action="remove-draft-item" data-index="${index}" aria-label="Remove item">×</button></div>`).join(""):'<p class="draft-empty">Add an item or service to begin.</p>';
  const subtotal=draftItems.reduce((sum,item)=>sum+item.price*item.quantity,0);
  const discountType=$("#discount-type")?.value||"percent";
  const discountValue=Number($('[name="discountValue"]')?.value||0);
  const discount=discountType==="percent"?subtotal*Math.min(Math.max(discountValue,0),100)/100:Math.min(Math.max(discountValue,0),subtotal);
  const taxable=subtotal-discount;
  const tax=draftItems.reduce((sum,item)=>sum+item.price*item.quantity*(subtotal?taxable/subtotal:0)*item.taxRate/100,0);
  $("#draft-totals").innerHTML=draftItems.length?`<span>Subtotal <strong>${money(subtotal)}</strong></span>${discount?`<span>Discount <strong>−${money(discount)}</strong></span>`:""}<span>Estimated tax <strong>${money(tax)}</strong></span><span class="total-line">Total <strong>${money(taxable+tax)}</strong></span>`:"";
}

function openStaffModal() {
  modal("Add billing staff",`${field("Full name","name","", "text",true)}${field("Email address","email","","email",true)}${field("Temporary password","password","","password",true)}<p class="field-hint">Use at least 10 characters. Share the temporary password securely.</p>`);
  $("#modal-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    try { await api("/api/team",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))});closeModal();toast("Staff member added.");await loadPage("team"); }
    catch(error){showModalError(error);}
  });
}

function openPaymentModal(invoiceId) {
  const invoice=state.invoices.find((item)=>item.id===invoiceId);
  if(!invoice) return;
  modal(`Record a payment`, `<div class="payment-context"><span>${escapeHtml(invoice.number)} · ${escapeHtml(invoice.client_name)}</span><strong>${money(invoice.total-invoice.paid)} remaining</strong></div>
    ${field("Amount received (₹)","amount",(invoice.total-invoice.paid).toFixed(2),"number",true)}
    <div class="form-grid form-grid-tight">${field("Date received","paidOn",today(),"date")}
    <label class="field"><span>Method</span><select name="method"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Card</option><option>Cheque</option><option>Other</option></select></label></div>
    ${field("Reference / note","note")}`);
  $("#modal-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const body=Object.fromEntries(new FormData(event.currentTarget).entries());body.amount=Number(body.amount);
    try { await api(`/api/invoices/${invoiceId}/payments`,{method:"POST",body:JSON.stringify(body)});closeModal();toast("Payment recorded.");await loadPage(state.page); }
    catch(error){showModalError(error);}
  });
}

function closeModal() { $("#modal-root").innerHTML=""; }
function showModalError(error) { $("#modal-error").textContent=error.message; }

async function printInvoice(invoiceId) {
  try {
    const [invoice,business]=await Promise.all([api(`/api/invoices/${invoiceId}`),api("/api/settings")]);
    state.business=business;
    const itemRows=invoice.items.map((item)=>`<tr><td>${escapeHtml(item.name)}${item.details?`<small>${escapeHtml(item.details)}</small>`:""}</td><td>${item.quantity} ${escapeHtml(item.unit||"")}</td><td>${money(item.price)}</td><td>${item.taxRate}%</td><td>${money(item.lineSubtotal+item.tax)}</td></tr>`).join("");
    const area=document.createElement("section");
    area.id="print-area";
    area.className="print-sheet";
    area.innerHTML=`<div class="print-head"><div><div class="print-brand">${business.logo_data?`<img src="${escapeHtml(business.logo_data)}" alt="Business logo">`:""}<div class="print-logo">${escapeHtml(business.name)}</div></div><h1>${invoice.tax_mode==="gst"?"TAX INVOICE":"INVOICE"}</h1><strong>${escapeHtml(invoice.number)}</strong></div><div class="print-date"><span>ISSUED</span><strong>${shortDate(invoice.issue_date)}</strong><span>DUE</span><strong>${shortDate(invoice.due_date)}</strong></div></div>
      <div class="print-parties"><div><small>FROM</small><strong>${escapeHtml(business.name)}</strong><span>${escapeHtml(business.address)}</span><span>${escapeHtml(business.email)}</span><span>${business.gstin?`GSTIN ${escapeHtml(business.gstin)}`:""}</span></div>
      <div><small>BILL TO</small><strong>${escapeHtml(invoice.client_name)}</strong><span>${escapeHtml(invoice.client_address)}</span><span>${escapeHtml(invoice.client_email)}</span><span>${invoice.client_gstin?`GSTIN ${escapeHtml(invoice.client_gstin)}`:""}</span></div></div>
      <table class="print-table"><thead><tr><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th>${invoice.tax_mode==="gst"?"GST":"TAX"}</th><th>AMOUNT</th></tr></thead><tbody>${itemRows}</tbody></table>
      <div class="print-summary"><p>Subtotal <strong>${money(invoice.subtotal)}</strong></p>${invoice.discount?`<p>Discount <strong>−${money(invoice.discount)}</strong></p><p>Taxable value <strong>${money(invoice.taxable)}</strong></p>`:""}${invoice.tax_mode==="gst"?(invoice.intra_state?`<p>CGST <strong>${money(invoice.cgst)}</strong></p><p>SGST <strong>${money(invoice.sgst)}</strong></p>`:`<p>IGST <strong>${money(invoice.igst)}</strong></p>`):`<p>Tax <strong>${money(invoice.tax_total)}</strong></p>`}<p class="print-total">Total <strong>${money(invoice.total)}</strong></p><p>Paid <strong>${money(invoice.paid)}</strong></p><p>Balance due <strong>${money(invoice.total-invoice.paid)}</strong></p></div>
      ${invoice.notes?`<div class="print-notes"><small>NOTE</small><p>${escapeHtml(invoice.notes)}</p></div>`:""}
      ${business.bank_name||business.bank_account_no?`<div class="print-notes"><small>BANK DETAILS</small><p>${escapeHtml(business.bank_name)} · ${escapeHtml(business.bank_account_name)} · ${escapeHtml(business.bank_account_no)} · IFSC ${escapeHtml(business.bank_ifsc)} · ${escapeHtml(business.bank_branch)}</p></div>`:""}
      ${invoice.terms||business.terms?`<div class="print-notes"><small>TERMS & CONDITIONS</small><p>${escapeHtml(invoice.terms||business.terms).replace(/\n/g,"<br>")}</p></div>`:""}
      ${business.seal_data?`<div class="print-seal"><img src="${escapeHtml(business.seal_data)}" alt="Business seal"></div>`:""}
      <footer>Thank you for your business.</footer>`;
    $("#modal-root").innerHTML=`<div class="modal-backdrop print-backdrop" data-action="close-modal"><section class="modal-card invoice-preview" role="dialog" aria-modal="true"><div class="preview-actions"><button class="button button-quiet" data-action="close-modal">Close</button><button class="button button-primary" data-action="do-print">Print / Save PDF</button></div>${area.outerHTML}</section></div>`;
    $("#modal-root").dataset.printInvoice=invoiceId;
  } catch(error) { toast(error.message,"error"); }
}

function doPrint() {
  document.body.classList.add("printing");
  window.print();
  window.setTimeout(()=>document.body.classList.remove("printing"),1000);
}

async function addStaffRemoval(id) {
  if(!window.confirm("Remove this billing staff member? Their access will end immediately.")) return;
  try { await api(`/api/team?id=${encodeURIComponent(id)}`,{method:"DELETE"});toast("Team member removed.");await loadPage("team"); }
  catch(error){toast(error.message,"error");}
}

async function removeRecord(type,id) {
  const config={
    client:{path:`/api/clients/${id}`,label:"client",page:"clients"},
    item:{path:`/api/products/${id}`,label:"item",page:"items"},
    invoice:{path:`/api/invoices/${id}`,label:"invoice",page:"invoices"},
  }[type];
  if(!config||!window.confirm(`Delete this ${config.label}? This cannot be undone.`)) return;
  try {
    await api(config.path,{method:"DELETE"});
    toast(`${config.label.charAt(0).toUpperCase()+config.label.slice(1)} deleted.`);
    await loadPage(config.page);
  } catch(error) { toast(error.message,"error"); }
}

function filterTable(value) {
  const query=value.trim().toLowerCase();
  $$("[data-searchable]").forEach((row)=>{row.hidden=!row.dataset.searchable.includes(query);});
}

function toggleTheme() {
  const dark=document.documentElement.classList.toggle("dark");
  localStorage.setItem("billforge-theme",dark?"dark":"light");
}

function installHelp() {
  modal("Add app to your device",`<div class="install-help"><p>Install this invoicing app for a quick, app-like launch from your home screen or desktop.</p>
    <div class="install-steps"><strong>Android / desktop</strong><span>Use the browser’s install icon, or open the browser menu and choose <b>Install app</b> / <b>Add to Home screen</b>.</span>
    <strong>iPhone / iPad</strong><span>In Safari, tap <b>Share</b>, then choose <b>Add to Home Screen</b>.</span></div>
    <p class="field-hint">Your browser decides whether installation is supported. Installation always requires your action.</p></div>`,`Got it`);
  $("#modal-form").addEventListener("submit",(event)=>{event.preventDefault();closeModal();});
}

async function installApp() {
  try {
    if(state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt=null;
      $("#install-button").hidden=true;
      $("#auth-install-button").hidden=true;
      return;
    }
    installHelp();
  } catch(error) {
    toast(`Could not open the browser install prompt: ${error.message}`,"error");
  }
}

document.addEventListener("click",async(event)=>{
  const button=event.target.closest("[data-action],[data-page],[data-auth-mode]");
  if(!button) return;
  if(button.dataset.authMode) { setAuthMode(button.dataset.authMode); return; }
  if(button.dataset.page) { event.preventDefault(); loadPage(button.dataset.page); return; }
  const { action,id }=button.dataset;
  if(action==="close-modal") {
    if(button.classList.contains("modal-backdrop") && event.target!==button) return;
    closeModal();
    return;
  }
  if(action==="new-client") openClientModal();
  else if(action==="edit-client") openClientModal(id);
  else if(action==="remove-client") removeRecord("client",id);
  else if(action==="new-product") openProductModal();
  else if(action==="edit-product") openProductModal(id);
  else if(action==="remove-product") removeRecord("item",id);
  else if(action==="remove-invoice") removeRecord("invoice",id);
  else if(action==="new-invoice") openInvoiceModal();
  else if(action==="new-staff") openStaffModal();
  else if(action==="add-payment") openPaymentModal(id);
  else if(action==="print-invoice") printInvoice(id);
  else if(action==="do-print") doPrint();
  else if(action==="remove-staff") addStaffRemoval(id);
  else if(action==="reload-page") loadPage(state.page);
  else if(action==="clear-image") {
    const input=$(`#${button.dataset.input}`);
    const preview=$(`#${button.dataset.input}-preview`);
    const remove=$(`[name="${button.dataset.remove}"]`);
    if(input) input.value="";
    if(preview) {preview.src="";preview.hidden=true;}
    if(remove) remove.value="true";
  }
  else if(action==="add-draft-item") {
    const product=state.products.find((item)=>item.id===$("#draft-product").value);
    if(product) draftItems.push({name:product.name,quantity:1,price:Number(product.price),taxRate:Number(product.tax_rate),hsn:product.hsn,unit:product.unit,details:product.description});
    renderDraftItems();
  } else if(action==="remove-draft-item") {
    draftItems.splice(Number(button.dataset.index),1);
    renderDraftItems();
  }
});

document.addEventListener("input",(event)=>{
  if(event.target.id==="table-search") filterTable(event.target.value);
  if(event.target.name==="discountValue") renderDraftItems();
});
document.addEventListener("change",(event)=>{
  if(event.target.id==="discount-type") renderDraftItems();
  if(event.target.matches("#logo-upload, #seal-upload, #profile-photo-upload")) previewImage(event.target);
});

async function previewImage(input) {
  const file=input.files?.[0];
  if(!file) return;
  if(!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>256*1024) {
    input.value="";
    toast("Choose a PNG, JPEG or WebP image smaller than 256 KB.","error");
    return;
  }
  try {
    const preview=$(`#${input.id}-preview`);
    preview.src=await fileToDataUrl(file);
    preview.hidden=false;
    const removeName=input.id==="logo-upload"?"removeLogo":input.id==="seal-upload"?"removeSeal":"removePhoto";
    $(`[name="${removeName}"]`).value="false";
  } catch(error) { toast(error.message,"error"); }
}

function fileToDataUrl(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

document.addEventListener("submit",async(event)=>{
  if(event.target.id==="settings-form") {
    event.preventDefault();
    const form=event.target;
    const data=new FormData(form);
    const body=Object.fromEntries([...data.entries()].filter(([,value])=>!(value instanceof File)));
    try {
      for(const [inputId,fieldName] of [["logo-upload","logoData"],["seal-upload","sealData"]]) {
        const file=$(`#${inputId}`).files?.[0];
        if(file) body[fieldName]=await fileToDataUrl(file);
      }
      if(body.removeLogo==="true") body.logoData="";
      if(body.removeSeal==="true") body.sealData="";
      delete body.removeLogo;
      delete body.removeSeal;
      const business=await api("/api/settings",{method:"PATCH",body:JSON.stringify(body)});
      state.business=business;
      toast("Business settings saved.");
      renderSettings(business);
    } catch(error) { toast(error.message,"error"); }
  }
  if(event.target.id==="profile-form") {
    event.preventDefault();
    const form=event.target;
    const data=new FormData(form);
    const body=Object.fromEntries([...data.entries()].filter(([,value])=>!(value instanceof File)));
    try {
      const photo=$("#profile-photo-upload").files?.[0];
      if(photo) body.avatarData=await fileToDataUrl(photo);
      if(body.removePhoto==="true") body.avatarData="";
      delete body.removePhoto;
      state.user=await api("/api/profile",{method:"PATCH",body:JSON.stringify(body)});
      renderUserChip(state.user);
      toast("Profile saved.");
      renderProfile();
    } catch(error) { toast(error.message,"error"); }
  }
});
$("#auth-form").addEventListener("submit",submitAuth);

$("#theme-toggle").addEventListener("click",toggleTheme);
$("#top-theme-toggle").addEventListener("click",toggleTheme);
$("#signout-button").addEventListener("click",async()=>{
  try { await api("/api/auth/logout",{method:"POST"}); }
  catch(error) { toast(error.message,"error"); }
  finally { state.user=null;state.business=null;$("#app-view").hidden=true;$("#auth-view").hidden=false;setAuthMode("login"); }
});
$("#mobile-menu").addEventListener("click",()=>$("#sidebar").classList.toggle("sidebar-open"));
$("#install-button").addEventListener("click",installApp);
$("#auth-install-button").addEventListener("click",installApp);
window.addEventListener("beforeinstallprompt",(event)=>{
  event.preventDefault();
  state.installPrompt=event;
  $("#install-button").hidden=false;
  $("#auth-install-button").hidden=false;
});
window.addEventListener("appinstalled",()=>{
  state.installPrompt=null;
  $("#install-button").hidden=true;
  $("#auth-install-button").hidden=true;
  toast("App is installed on this device.");
});
if(localStorage.getItem("billforge-theme")==="dark") document.documentElement.classList.add("dark");
if(window.matchMedia("(display-mode: standalone)").matches || navigator.standalone===true) {
  $("#auth-install-button").hidden=true;
  $("#install-button").hidden=true;
}
if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js")
  .catch((error)=>console.error("Could not register the offline app shell:",error));
bootstrap();
