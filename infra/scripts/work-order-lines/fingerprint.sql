SELECT jsonb_build_object(
'orders',(SELECT jsonb_object_agg(id,md5(to_jsonb(r)::text)) FROM service_records r),
'parts',(SELECT jsonb_object_agg(id,md5((to_jsonb(p)-'discountType'-'discountValue'-'sortOrder')::text)) FROM service_parts p),
'labor',(SELECT jsonb_object_agg(id,md5((to_jsonb(l)-'technicianId'-'executorName'-'executorFrozen'-'executorLegacy'-'sortOrder')::text)) FROM service_labor l),
'payments',(SELECT jsonb_object_agg(id,md5(to_jsonb(p)::text)) FROM payments p),
'inventory',(SELECT jsonb_object_agg(id,md5(to_jsonb(p)::text)) FROM inventory_parts p));
