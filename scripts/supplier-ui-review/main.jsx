import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import suppliers from "../../messages/uk/suppliers.json";
import "../../src/app/globals.css";
import List from "../../src/app/(authenticated)/suppliers/page";
import Detail from "../../src/app/(authenticated)/suppliers/[id]/page";
import { SupplierEditor } from "../../src/features/suppliers/Components/SupplierEditor";
import { SupplierPicker } from "../../src/features/suppliers/Components/SupplierPicker";
import { SupplierImportPreview } from "../../src/features/suppliers/Components/SupplierImportPreview";
import { PageHeader } from "./header";
import { getSupplier } from "./actions";
function Picker() {
  const [value, setValue] = useState("fixture-28");
  return <><PageHeader /><main className="p-6 max-w-4xl"><SupplierPicker value={value} onChange={setValue} /><p role="status">Обраний ID: {value ?? "\u043D\u0435\u043C\u0430\u0454"}</p><label>Попередня назва постачальника<input className="border p-2" defaultValue="Стара назва" /></label></main></>;
}
let content;
let path = location.pathname.split("/").filter(Boolean);
if (path[0] === "picker") content = <Picker />;
else if (path[1] === "import") content = <><PageHeader /><main className="p-6"><h1 className="text-2xl mb-4">Перевірка перенесення з Carbook</h1><SupplierImportPreview /></main></>;
else if (path[1] === "new") content = <><PageHeader /><main className="p-6"><h1 className="text-2xl mb-4">Додати постачальника</h1><SupplierEditor /></main></>;
else if (path[2] === "edit") {
  let r = await getSupplier(path[1]);
  content = <><PageHeader /><main className="p-6"><h1 className="text-2xl mb-4">Редагувати постачальника</h1><SupplierEditor id={path[1]} initial={r.data?.supplier} updatedAt={r.data?.supplier.updatedAt.toISOString()} /></main></>;
} else if (path[1]) content = await Detail({ params: Promise.resolve({ id: path[1] }) });
else content = await List({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(location.search))) });
createRoot(document.getElementById("root")).render(<NextIntlClientProvider locale="uk" messages={{ suppliers }}>{content}</NextIntlClientProvider>);
