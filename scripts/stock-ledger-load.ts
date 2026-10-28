import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createStockLedger } from '../src/features/stock-ledger/Lib/service'
import { stockSummary,stockHistory } from '../src/features/stock-ledger/Lib/stockReports'
const url=process.env.LEDGER_TEST_DATABASE_URL
if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55439\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated Docker DB 55439 only')
const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})})
async function main(){
 const prefix='load-'+randomUUID(),user=await db.user.create({data:{name:'Synthetic load',email:prefix+'@example.test'}}),org=await db.organization.create({data:{name:'Synthetic 50k / 500k load'}}),ctx={organizationId:org.id,userId:user.id},ledger=createStockLedger(db,ctx)
 const supplier=await ledger.createSupplier({idempotencyKey:randomUUID(),name:'Synthetic supplier'}),warehouse=await ledger.createWarehouse({idempotencyKey:randomUUID(),code:'LOAD',name:'Load warehouse',isDefault:true})
 for(let batch=0;batch<50;batch++)await db.inventoryPart.createMany({data:Array.from({length:1000},(_,i)=>({id:prefix+'-'+(batch*1000+i),organizationId:org.id,userId:user.id,name:'Load product '+String(batch*1000+i).padStart(5,'0'),partNumber:'SKU-'+String(batch*1000+i).padStart(5,'0'),unit:'pcs'}))})
 const draft=await ledger.saveReceiptDraft({idempotencyKey:randomUUID(),supplierId:supplier.id,warehouseId:warehouse.id,effectiveAt:'2026-10-23',externalDate:'2026-10-23',dueDate:'2026-10-23',externalNumber:prefix,lines:[{inventoryPartId:prefix+'-0',quantity:'1',unitPrice:'1'}]})
 await ledger.postReceipt({idempotencyKey:randomUUID(),documentId:draft.id,expectedVersion:1})
 const entry=await db.inventoryLedgerEntry.findFirstOrThrow({where:{organizationId:org.id}})
 // Synthetic balanced pairs intentionally stress one hot lot's history; net quantity/cost stays unchanged.
 for(let batch=0;batch<10;batch++)await db.$executeRaw`INSERT INTO inventory_ledger_entries (id,"organizationId","quantityDelta","costAmountDelta","effectiveAt","operationKey","lotId","warehouseId","documentLineId") SELECT ${prefix}||'-event-'||g,${org.id},CASE WHEN g%2=0 THEN 1 ELSE -1 END,CASE WHEN g%2=0 THEN 1 ELSE -1 END,'2026-10-23'::date,${prefix}||'-op-'||g,${entry.lotId},${warehouse.id},${entry.documentLineId} FROM generate_series(${batch*50000}::integer,${batch*50000+49999}::integer) g`
 await db.$executeRawUnsafe('ANALYZE inventory_parts')
 await db.$executeRawUnsafe('ANALYZE inventory_ledger_entries')
 const measurements:Record<string,number[]>={search:[],list:[],history:[],post100:[]}
 async function timed(name:string,fn:()=>Promise<unknown>){const start=performance.now();await fn();measurements[name].push(performance.now()-start)}
 for(let round=0;round<3;round++)await Promise.all(Array.from({length:10},async(_,i)=>{
  await timed('search',()=>db.inventoryPart.findMany({where:{organizationId:org.id,OR:[{name:{contains:'499',mode:'insensitive'}},{partNumber:{contains:'499',mode:'insensitive'}}]},select:{id:true,name:true},take:25}))
  await timed('list',()=>db.$transaction(tx=>stockSummary(tx,ctx,{search:i%2?'Load':'SKU-00499'}),{timeout:60000}))
  await timed('history',()=>db.$transaction(tx=>stockHistory(tx,ctx,{productId:prefix+'-0',warehouseId:warehouse.id}),{timeout:60000}))
 }))
 for(let i=0;i<5;i++){
 const receipt=await ledger.saveReceiptDraft({idempotencyKey:randomUUID(),supplierId:supplier.id,warehouseId:warehouse.id,effectiveAt:'2026-10-23',externalDate:'2026-10-23',dueDate:'2026-10-23',externalNumber:prefix+'-100-'+i,lines:Array.from({length:100},(_,n)=>({inventoryPartId:prefix+'-'+n,quantity:'1',unitPrice:'1.234567'}))})
 await timed('post100',()=>ledger.postReceipt({idempotencyKey:randomUUID(),documentId:receipt.id,expectedVersion:1}))
 }
 const result={organizationId:org.id,products:50000,syntheticMovements:500000,concurrentReaders:10,hotLot:true,metrics:Object.fromEntries(Object.entries(measurements).map(([name,values])=>{values.sort((a,b)=>a-b);return[name,{samples:values.length,p95:Math.round(values[Math.ceil(values.length*.95)-1]),max:Math.round(values[values.length-1])}]}))}
 await writeFile('test-results/stock-ledger-load.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect())
