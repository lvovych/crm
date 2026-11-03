import { supplierSchema } from "../../src/features/suppliers/Schema/supplierSchema";
import { buildSupplierPreview, supplierSnapshotSchema } from "../../src/features/suppliers/Lib/preview";
const base = Array.from({ length: 28 }, (_, i) => ({ id: "fixture-" + (i + 1), ...supplierSchema.parse({ name: i === 0 ? "\u0422\u0435\u0441\u0442\u043E\u0432\u0438\u0439 \u043F\u043E\u0441\u0442\u0430\u0447\u0430\u043B\u044C\u043D\u0438\u043A" : `\u041F\u043E\u0441\u0442\u0430\u0447\u0430\u043B\u044C\u043D\u0438\u043A ${String(i + 1).padStart(2, "0")}`, contacts: [{ name: "\u041E\u043B\u0435\u043D\u0430", role: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440", phone: "+380501234567", email: "supplier@example.test", isPrimary: true }], bankAccounts: [{ accountNumber: "TEST-ACCOUNT", bankName: "\u0422\u0435\u0441\u0442\u043E\u0432\u0438\u0439 \u0431\u0430\u043D\u043A", currency: "UAH", isPrimary: true }], paymentTermDays: i === 0 ? 0 : null }), isArchived: i === 27, updatedAt: /* @__PURE__ */ new Date("2026-11-03T10:00:00Z") }));
function load() {
  return JSON.parse(sessionStorage.getItem("supplier-fixtures") ?? JSON.stringify(base));
}
function store(data) {
  sessionStorage.setItem("supplier-fixtures", JSON.stringify(data));
}
function decorate(s) {
  return { ...s, updatedAt: new Date(s.updatedAt), supplierProfile: { paymentTermDays: s.paymentTermDays, paymentTerms: s.paymentTerms }, contacts: s.contacts.map((c, i) => ({ ...c, id: "c" + i })), bankAccounts: s.bankAccounts.map((b, i) => ({ ...b, id: "b" + i })), sourceLinks: [], preferredParts: [{ id: "test-part", name: "\u0422\u0435\u0441\u0442\u043E\u0432\u0430 \u0437\u0430\u043F\u0447\u0430\u0441\u0442\u0438\u043D\u0430", partNumber: "TEST-001" }] };
}
async function supplierDirectoryAvailable() {
  return { success: true, data: true };
}
async function getSupplierCapabilities() {
  return { success: true, data: { create: true, update: true, archive: true, import: true } };
}
async function listSuppliers(p = {}) {
  let items = load().filter((s) => (p.archived === "all" || s.isArchived === (p.archived === "archived")) && (!p.search || JSON.stringify(s).toLowerCase().includes(p.search.toLowerCase())) && p.source !== "carbook");
  let page = Number(p.page ?? 1);
  return { success: true, data: { items: items.slice((page - 1) * 25, page * 25).map(decorate), total: items.length, page } };
}
async function getSupplier(id) {
  let s = load().find((s2) => s2.id === id);
  return s ? { success: true, data: { supplier: decorate(s), history: [{ id: "h1", timestamp: /* @__PURE__ */ new Date("2026-11-03T10:00:00Z"), action: "create" }] } } : { success: false, error: "\u041D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E" };
}
async function saveSupplier(input, id) {
  let parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  let all = load(), saved = { ...parsed.data, id: id ?? "fixture-created-" + Date.now(), isArchived: false, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  store(id ? all.map((s) => s.id === id ? saved : s) : [saved, ...all]);
  return { success: true, data: { id: saved.id } };
}
async function archiveSupplier(id, isArchived) {
  store(load().map((s) => s.id === id ? { ...s, isArchived } : s));
  return { success: true };
}
async function previewSupplierImport(text) {
  try {
    return { success: true, data: { ...buildSupplierPreview(supplierSnapshotSchema.parse(JSON.parse(text)), []), periodStart: JSON.parse(text).periodStart, snapshotAt: JSON.parse(text).snapshotAt, runId: "fixture-preview" } };
  } catch {
    return { success: false, error: "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 \u0444\u0430\u0439\u043B \u0434\u0430\u043D\u0438\u0445" };
  }
}
export {
  archiveSupplier,
  getSupplier,
  getSupplierCapabilities,
  listSuppliers,
  previewSupplierImport,
  saveSupplier,
  supplierDirectoryAvailable
};
