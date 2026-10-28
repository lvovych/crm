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
 const previous = JSON.parse(await (await import('node:fs/promises')).readFile('test-results/stock-ledger-load.json','utf8'))
 const org=await db.organization.findFirstOrThrow({where:{id:previous.organizationId,name:'Synthetic 50k / 500k load'}}),product=await db.inventoryPart.findFirstOrThrow({where:{organizationId:org.id,partNumber:'SKU-00000'}}),prefix=product.id.slice(0,product.id.lastIndexOf('-')),ctx={organizationId:org.id,userId:product.userId},ledger=createStockLedger(db,ctx),supplier=await db.supplier.findFirstOrThrow({where:{organizationId:org.id}}),warehouse=await db.warehouse.findFirstOrThrow({where:{organizationId:org.id,isDefault:true}})
 const measurements:Record<string,number[]>={search:[],list:[],history:[],post100:[]}
 async function timed(name:string,fn:()=>Promise<unknown>){const start=performance.now();await fn();measurements[name].push(performance.now()-start)}
 for(let round=0;round<3;round++)await Promise.all(Array.from({length:10},async(_,i)=>{
  await timed('search',()=>db.inventoryPart.findMany({where:{organizationId:org.id,OR:[{name:{contains:'499',mode:'insensitive'}},{partNumber:{contains:'499',mode:'insensitive'}}]},select:{id:true,name:true},take:25}))
  await timed('list',()=>db.$transaction(tx=>stockSummary(tx,ctx,{search:i%2?'Load':'SKU-00499'}),{timeout:60000}))
  await timed('history',()=>db.$transaction(tx=>stockHistory(tx,ctx,{productId:prefix+'-0',warehouseId:warehouse.id}),{timeout:60000}))
 }))
 for(let i=0;i<5;i++){
 const receipt=await ledger.saveReceiptDraft({idempotencyKey:randomUUID(),supplierId:supplier.id,warehouseId:warehouse.id,effectiveAt:'2026-10-23',externalDate:'2026-10-23',dueDate:'2026-10-23',externalNumber:prefix+'-100-'+i+'-'+randomUUID(),lines:Array.from({length:100},(_,n)=>({inventoryPartId:prefix+'-'+n,quantity:'1',unitPrice:'1.234567'}))})
 await timed('post100',()=>ledger.postReceipt({idempotencyKey:randomUUID(),documentId:receipt.id,expectedVersion:1}))
 }
 const result={organizationId:org.id,products:50000,syntheticMovements:500000,concurrentReaders:10,hotLot:true,metrics:Object.fromEntries(Object.entries(measurements).map(([name,values])=>{values.sort((a,b)=>a-b);return[name,{samples:values.length,p95:Math.round(values[Math.ceil(values.length*.95)-1]),max:Math.round(values[values.length-1])}]}))}
 await writeFile('test-results/stock-ledger-load-verified.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect())
