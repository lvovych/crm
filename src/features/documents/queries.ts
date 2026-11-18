import { Prisma } from '@/generated/prisma/client'
import { z } from 'zod'
import { documentTypes, type DocumentScope, type JournalRow, type DocumentEdge } from './types'

type Reader = { $queryRaw<T>(query: Prisma.Sql): Promise<T> }
export const journalFilter = z
  .object({
    q: z.string().trim().max(120).default(''),
    type: z.enum(['', ...Object.keys(documentTypes)] as [string, ...string[]]).default(''),
    from: z.union([z.literal(''), z.string().date()]).default(''),
    to: z.union([z.literal(''), z.string().date()]).default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .refine((p) => !p.from || !p.to || p.from <= p.to, 'Початок періоду має бути не пізніше кінця.')

/** Every source is tenant-scoped before union, search, pagination, or graph traversal. */
export function visibleDocuments(s: DocumentScope): Prisma.Sql {
  const org = s.organizationId,
    queries: Prisma.Sql[] = []
  if (s.receipts) {
    queries.push(Prisma.sql`SELECT 'receipt:'||r.id AS key, 'receipt' AS type, r.id, 'Накладна № '||r.number AS label,
      c.name AS party, r."receivedDate"::text AS date, coalesce((SELECT sum(l.amount) FROM supplier_receipt_lines l WHERE l."receiptId"=r.id),0)::text AS amount,
      r.status, '/receipts/'||r.id AS href, 'Дата документа: '||r."documentDate"::text AS note
      FROM supplier_receipts r JOIN counterparties c ON c.id=r."supplierId" AND c."organizationId"=r."organizationId" WHERE r."organizationId"=${org}`)
    queries.push(Prisma.sql`SELECT 'return:'||d.id,'return',d.id,d.number,c.name,d.date::text,
      coalesce((SELECT sum(l.amount) FROM supplier_return_lines l WHERE l."returnId"=d.id),0)::text,
      'posted','/receipts/'||r.id||'/returns/'||d.id,d.reason
      FROM supplier_returns d JOIN supplier_receipts r ON r.id=d."receiptId" AND r."organizationId"=d."organizationId"
      JOIN counterparties c ON c.id=r."supplierId" AND c."organizationId"=r."organizationId" WHERE d."organizationId"=${org}`)
  }
  if (s.orders) {
    queries.push(Prisma.sql`SELECT 'order:'||r.id,'order',r.id,'Наряд / рахунок '||coalesce(r."invoiceNumber",r.title),
      coalesce(c.name,vc.name,''),coalesce(r."invoiceDate",r."serviceDate")::date::text,round(r."totalAmount"::numeric,2)::text,r.status,
      CASE WHEN r."vehicleId" IS NULL THEN '/sales/'||r.id ELSE '/vehicles/'||r."vehicleId"||'/service/'||r.id END,r.title
      FROM service_records r LEFT JOIN customers c ON c.id=r."customerId" AND c."organizationId"=r."organizationId"
      LEFT JOIN vehicles v ON v.id=r."vehicleId" AND v."organizationId"=r."organizationId"
      LEFT JOIN customers vc ON vc.id=v."customerId" AND vc."organizationId"=r."organizationId" WHERE r."organizationId"=${org}`)
    queries.push(Prisma.sql`SELECT 'payment:'||p.id,'payment',p.id,'Оплата клієнта',coalesce(c.name,vc.name,''),p.date::date::text,
      coalesce(p."amountExact",round(p.amount::numeric,2))::text,'posted',
      CASE WHEN r."vehicleId" IS NULL THEN '/sales/'||r.id ELSE '/vehicles/'||r."vehicleId"||'/service/'||r.id END,coalesce(p.note,'')
      FROM payments p JOIN service_records r ON r.id=p."serviceRecordId"
      LEFT JOIN customers c ON c.id=r."customerId" AND c."organizationId"=r."organizationId"
      LEFT JOIN vehicles v ON v.id=r."vehicleId" AND v."organizationId"=r."organizationId"
      LEFT JOIN customers vc ON vc.id=v."customerId" AND vc."organizationId"=r."organizationId"
      WHERE r."organizationId"=${org} AND NOT EXISTS(SELECT 1 FROM financial_documents d WHERE d."paymentId"=p.id)`)
  }
  if (s.finance) {
    const ids = s.accounts.length ? Prisma.join(s.accounts) : Prisma.sql`NULL`
    queries.push(Prisma.sql`SELECT 'finance:'||d.id,'finance',d.id,
      (CASE d.kind WHEN 'income' THEN 'Надходження коштів' WHEN 'expense' THEN 'Витрата коштів' WHEN 'transfer' THEN 'Переказ між рахунками'
      WHEN 'customer_payment' THEN 'Оплата клієнта' WHEN 'supplier_payment' THEN 'Оплата постачальнику'
      WHEN 'opening' THEN 'Початковий залишок' WHEN 'reversal' THEN 'Сторнування' WHEN 'refund' THEN 'Повернення коштів' ELSE 'Фінансовий документ' END)||' · '||left(d.id,8),
      coalesce(nullif(d."counterpartyLabel",''), CASE WHEN ${s.settlements} THEN supplier.name END, CASE WHEN ${s.orders} THEN coalesce(customer.name,vehicle_customer.name) END,''),d.date::text,d.amount::text,
      CASE WHEN EXISTS(SELECT 1 FROM financial_documents rev WHERE rev."reversalOfId"=d.id) THEN 'reversed' ELSE d.status END,
      '/finance',concat_ws(' · ',a.name,b.name,cat.name,d.note)
      FROM financial_documents d LEFT JOIN money_accounts a ON a.id=d."sourceAccountId" AND a."organizationId"=d."organizationId"
      LEFT JOIN money_accounts b ON b.id=d."targetAccountId" AND b."organizationId"=d."organizationId"
      LEFT JOIN cash_flow_categories cat ON cat.id=d."categoryId" AND cat."organizationId"=d."organizationId"
      LEFT JOIN supplier_entries se ON se.id=d."supplierEntryId" AND se."organizationId"=d."organizationId"
      LEFT JOIN counterparties supplier ON supplier.id=se."supplierId" AND supplier."organizationId"=d."organizationId"
      LEFT JOIN payments payment ON payment.id=d."paymentId"
      LEFT JOIN service_records order_record ON order_record.id=payment."serviceRecordId" AND order_record."organizationId"=d."organizationId"
      LEFT JOIN customers customer ON customer.id=order_record."customerId" AND customer."organizationId"=d."organizationId"
      LEFT JOIN vehicles vehicle ON vehicle.id=order_record."vehicleId" AND vehicle."organizationId"=d."organizationId"
      LEFT JOIN customers vehicle_customer ON vehicle_customer.id=vehicle."customerId" AND vehicle_customer."organizationId"=d."organizationId"
      WHERE d."organizationId"=${org}
      AND (d."sourceAccountId" IS NULL OR d."sourceAccountId" IN (${ids}))
      AND (d."targetAccountId" IS NULL OR d."targetAccountId" IN (${ids}))
      AND (${s.payroll} OR d.id NOT IN (
        WITH RECURSIVE payroll_documents(id) AS (
          SELECT sp."documentId" FROM "StaffPayment" sp JOIN financial_documents f ON f.id=sp."documentId" WHERE f."organizationId"=${org}
          UNION SELECT child.id FROM financial_documents child JOIN payroll_documents parent
          ON child."reversalOfId"=parent.id OR child."originalId"=parent.id WHERE child."organizationId"=${org}
        ) SELECT id FROM payroll_documents
      ))`)
  }
  if (s.settlements)
    queries.push(Prisma.sql`SELECT 'supplier:'||e.id,'supplier',e.id,
    CASE e.kind WHEN 'payment' THEN 'Оплата постачальнику' WHEN 'adjustment_debt' THEN 'Коригування: збільшення боргу' WHEN 'adjustment_credit' THEN 'Коригування: зменшення боргу'
    WHEN 'opening_debt' THEN 'Початковий борг' ELSE 'Початковий аванс' END,
    c.name,e.date::text,e.amount::text,CASE WHEN e."reversedAt" IS NULL THEN 'posted' ELSE 'reversed' END,
    '/settlements?supplier='||e."supplierId",coalesce(e.note,'')
    FROM supplier_entries e JOIN counterparties c ON c.id=e."supplierId" AND c."organizationId"=e."organizationId"
    WHERE e."organizationId"=${org} AND e.kind IN ('payment','adjustment_debt','adjustment_credit','opening_debt','opening_credit')
    AND NOT EXISTS(SELECT 1 FROM financial_documents d WHERE d."supplierEntryId"=e.id)`)
  if (s.payroll)
    queries.push(Prisma.sql`SELECT 'salary:'||p.id,'salary',p.id,'SAL · '||p."start"::text||' — '||p."end"::text,t.name,p."end"::text,p.total::text,p.status,
    '/payroll?employee='||t.id||'&slip='||p.id,'Нарахування за період'
    FROM "PaySlip" p JOIN technicians t ON t.id=p."technicianId" WHERE t."organizationId"=${org}`)
  return queries.length
    ? Prisma.sql`SELECT * FROM (${Prisma.join(queries, ' UNION ALL ')}) AS documents(key,type,id,label,party,date,amount,status,href,note)`
    : Prisma.sql`SELECT ''::text AS key,''::text AS type,''::text AS id,''::text AS label,''::text AS party,''::text AS date,''::text AS amount,''::text AS status,''::text AS href,''::text AS note WHERE false`
}

export async function readJournal(db: Reader, scope: DocumentScope, raw: unknown) {
  const f = journalFilter.parse(raw),
    visible = visibleDocuments(scope)
  const search = '%' + f.q.replace(/[\\%_]/g, '\\$&') + '%'
  const where = Prisma.sql`(${f.type}='' OR type=${f.type}) AND (${f.from}='' OR date>=${f.from}) AND (${f.to}='' OR date<=${f.to})
    AND (label ILIKE ${search} OR party ILIKE ${search} OR note ILIKE ${search})`
  const result = await db.$queryRaw<{ rows: JournalRow[]; total: number }[]>(Prisma.sql`
    WITH visible AS (${visible}), filtered AS (SELECT * FROM visible WHERE ${where})
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      coalesce((SELECT json_agg(page) FROM (SELECT * FROM filtered ORDER BY date DESC,key DESC LIMIT 25 OFFSET ${(f.page - 1) * 25}) page),'[]'::json) AS rows`)
  return { ...result[0], filters: f }
}

export function documentEdges(org: string): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT 'receipt:'||r.id AS source,'order:'||t."serviceRecordId" AS target,'Передано товари в наряд' AS relation
    FROM receipt_transfers t JOIN supplier_receipt_lines l ON l.id=t."lineId" JOIN supplier_receipts r ON r.id=l."receiptId"
    JOIN service_records o ON o.id=t."serviceRecordId" AND o."organizationId"=r."organizationId" WHERE r."organizationId"=${org}
    UNION SELECT 'receipt:'||r.id,'order:'||sl."serviceRecordId",'Послуга постачальника для наряду'
    FROM subcontract_work w JOIN service_labor sl ON sl.id=w."laborId" JOIN supplier_receipt_lines l ON l.id=w."receiptLineId"
    JOIN supplier_receipts r ON r.id=l."receiptId" JOIN service_records o ON o.id=sl."serviceRecordId" AND o."organizationId"=r."organizationId" WHERE r."organizationId"=${org}
    UNION SELECT 'receipt:'||d."receiptId",'return:'||d.id,'Повернення з накладної' FROM supplier_returns d WHERE d."organizationId"=${org}
    UNION SELECT 'order:'||p."serviceRecordId",coalesce('finance:'||d.id,'payment:'||p.id),'Оплата наряду'
    FROM payments p JOIN service_records o ON o.id=p."serviceRecordId" LEFT JOIN financial_documents d ON d."paymentId"=p.id AND d."organizationId"=o."organizationId" WHERE o."organizationId"=${org}
    UNION SELECT coalesce('receipt:'||debit."receiptId",'supplier:'||debit.id),
      coalesce('return:'||credit."returnId",'finance:'||d.id,'supplier:'||credit.id),
      CASE WHEN a."reversedAt" IS NULL THEN 'Зараховано '||sum(a.amount)::text||' грн' ELSE 'Скасовано зарахування '||sum(a.amount)::text||' грн' END
    FROM supplier_allocations a JOIN supplier_entries debit ON debit.id=a."debitId" JOIN supplier_entries credit ON credit.id=a."creditId" AND credit."organizationId"=debit."organizationId" AND credit."supplierId"=debit."supplierId"
    LEFT JOIN financial_documents d ON d."supplierEntryId"=credit.id AND d."organizationId"=credit."organizationId" WHERE debit."organizationId"=${org}
    GROUP BY debit."receiptId",debit.id,credit."returnId",d.id,credit.id,(a."reversedAt" IS NULL)
    UNION SELECT 'finance:'||d."reversalOfId",'finance:'||d.id,'Сторнування документа' FROM financial_documents d WHERE d."organizationId"=${org} AND d."reversalOfId" IS NOT NULL
    UNION SELECT 'finance:'||d."originalId",'finance:'||d.id,'Повернення коштів' FROM financial_documents d WHERE d."organizationId"=${org} AND d."originalId" IS NOT NULL
    UNION SELECT 'salary:'||a."slipId",'finance:'||sp."documentId",'Зараховано виплату '||a.amount::text||' грн'
    FROM "StaffAllocation" a JOIN "StaffPayment" sp ON sp.id=a."paymentId" JOIN technicians t ON t.id=sp."technicianId" WHERE t."organizationId"=${org}
  `
}
export async function readDocument(db: Reader, scope: DocumentScope, key: string) {
  const visible = visibleDocuments(scope)
  const rows = await db.$queryRaw<JournalRow[]>(
    Prisma.sql`SELECT * FROM (${visible}) v WHERE key=${key}`
  )
  if (!rows[0]) return null
  // Traverse only the current document's neighbourhood. Joining the entire
  // journal twice inside a recursive CTE made real-world archives very slow.
  // Check visibility at every hop: inaccessible documents must never be bridges.
  const documents = new Map(rows.map((row) => [row.key, row]))
  const edges = new Map<string, DocumentEdge>()
  const visited = new Set<string>()
  let frontier = [key]
  let truncated = false
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const candidates = await db.$queryRaw<DocumentEdge[]>(Prisma.sql`
      SELECT * FROM (${documentEdges(scope.organizationId)}) links
      WHERE source IN (${Prisma.join(frontier)}) OR target IN (${Prisma.join(frontier)})
      ORDER BY source,target,relation LIMIT 1001`)
    if (candidates.length > 1000) truncated = true
    const batch = candidates.slice(0, 1000)
    const keys = [...new Set(batch.flatMap((edge) => [edge.source, edge.target]))].filter(
      (id) => !documents.has(id)
    )
    if (keys.length) {
      const permitted = await db.$queryRaw<JournalRow[]>(Prisma.sql`
        SELECT * FROM (${visible}) v WHERE key IN (${Prisma.join(keys)})`)
      for (const row of permitted) documents.set(row.key, row)
    }
    for (const id of frontier) visited.add(id)
    const next = new Set<string>()
    for (const edge of batch) {
      if (!documents.has(edge.source) || !documents.has(edge.target)) continue
      edges.set(JSON.stringify(edge), edge)
      for (const id of [edge.source, edge.target]) if (!visited.has(id)) next.add(id)
    }
    if (edges.size > 100) {
      truncated = true
      break
    }
    frontier = [...next]
  }
  const shown = [...edges.values()].slice(0, 100)
  const used = new Set(shown.flatMap((edge) => [edge.source, edge.target]))
  const related = [...documents.values()].filter((row) => used.has(row.key))
  return { document: rows[0], related, edges: shown, truncated }
}
