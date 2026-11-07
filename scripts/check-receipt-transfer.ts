import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { transferReceiptGoods } from '../src/features/receipts/transfer-ledger'
import { DOCUMENT_LOCK_DEFAULTS } from '../src/lib/document-lock'
import { transitionReceipt } from '../src/features/receipts/ledger'
const url = new URL(process.env.DATABASE_URL || '')
assert(['localhost','127.0.0.1'].includes(url.hostname) && (url.pathname.endsWith('_test') || url.pathname === '/torqvoice_e2e'))
const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}).$extends({query:{}})
async function main() {
  const {organizationId,userId} = await db.organizationMember.findFirstOrThrow({where:{role:'owner'}})
  const vehicle = await db.vehicle.findFirstOrThrow({where:{organizationId}})
  const supplier = await db.counterparty.create({data:{organizationId,createdById:userId,name:'Демо · Передавання товарів',supplierProfile:{create:{}}}})
  const parts = await Promise.all(['Фільтр повітряний','Олива моторна'].map((name,i)=>db.inventoryPart.create({data:{organizationId,userId,name,partNumber:`TRANSFER-${i}`,unit:i?'л':'шт',quantity:0,unitCost:i?180:200,sellPrice:i?250:300}})))
  const order = await db.serviceRecord.create({data:{organizationId,vehicleId:vehicle.id,createdById:userId,title:'Демо · Передавання з накладної',invoiceNumber:'DEMO-TRANSFER',status:'in-progress',serviceDate:new Date()}})
  const receipt = await db.supplierReceipt.create({data:{organizationId,supplierId:supplier.id,createdById:userId,number:'DEMO-TRANSFER-'+randomUUID().slice(0,8),documentDate:new Date(),receivedDate:new Date(),lines:{create:parts.map((p,i)=>({position:i,kind:'part',name:p.name,article:p.partNumber,partId:p.id,unit:p.unit!,quantity:i?10:4,unitPrice:i?180:200,amount:i?1800:800}))}},include:{lines:{orderBy:{position:'asc'}}}})
  const transfer = (lines: {id:string;quantity:string;unitPrice:string}[], extra: Record<string,unknown> = {}, org=organizationId) => db.$transaction(tx=>transferReceiptGoods(tx,org,userId,{receiptId:receipt.id,serviceRecordId:order.id,requestId:randomUUID(),lines,...extra},DOCUMENT_LOCK_DEFAULTS))
  const a={id:receipt.lines[0].id,quantity:'1',unitPrice:'300'}
  const b={id:receipt.lines[1].id,quantity:'0.001',unitPrice:'5'}
  try {
    await assert.rejects(transfer([a]),/проведеної/)
    await db.$transaction(tx=>transitionReceipt(tx,organizationId,userId,receipt.id,1,'posted',''))
    if (process.argv.includes('--review-only')) { console.log('Review: http://localhost:3212/receipts/' + receipt.id); return }
    await assert.rejects(transfer([a],{},'other-org'))
    await assert.rejects(transfer([{...a,id:'foreign-line'}]))
    await assert.rejects(transfer([a,a]))
    await assert.rejects(transfer([a],{serviceRecordId:'other-order'}))
    await db.serviceRecord.update({where:{id:order.id},data:{status:'completed'}})
    await assert.rejects(transfer([a]),/відкритий/)
    await db.serviceRecord.update({where:{id:order.id},data:{status:'in-progress'}})
    const key=randomUUID()
    await Promise.all([transfer([a],{requestId:key}),transfer([a],{requestId:key})])
    assert.equal(await db.servicePart.count({where:{serviceRecordId:order.id}}),1)
    assert.equal((await db.inventoryPart.findUniqueOrThrow({where:{id:parts[0].id}})).quantity,3)
    await assert.rejects(transfer([{...a,quantity:'2'}],{requestId:key}),/запит/)
    const before=await db.servicePart.count({where:{serviceRecordId:order.id}})
    await assert.rejects(transfer([a,{...b,quantity:'10.001'}]))
    assert.equal(await db.servicePart.count({where:{serviceRecordId:order.id}}),before)
    await transfer([a,b])
    assert.equal((await db.serviceRecord.findUniqueOrThrow({where:{id:order.id}})).subtotal,600.01)
    assert.equal((await db.inventoryPart.findUniqueOrThrow({where:{id:parts[1].id}})).quantity,9.999)
    const raced=await Promise.allSettled([transfer([{...a,quantity:'2'}]),transfer([{...a,quantity:'2'}])])
    assert.equal(raced.filter(r=>r.status==='fulfilled').length,1)
    const snapshot=await db.servicePart.count({where:{serviceRecordId:order.id}})
    await db.inventoryPart.update({where:{id:parts[1].id},data:{quantity:0}})
    await assert.rejects(transfer([b]),/недостатньо/)
    assert.equal(await db.servicePart.count({where:{serviceRecordId:order.id}}),snapshot)
    await db.inventoryPart.update({where:{id:parts[1].id},data:{quantity:9.999}})
    await assert.rejects(db.$transaction(tx=>transitionReceipt(tx,organizationId,userId,receipt.id,2,'cancelled','QA')),/передавання/)
    assert.equal((await db.supplierReceipt.findUniqueOrThrow({where:{id:receipt.id}})).status,'posted')
    console.log('PASS: draft, tenant, foreign rows/order, duplicate rows, closed order, retry idempotency, request reuse, atomic rollback, totals/rounding, concurrent over-allocation, insufficient stock, cancel protection.')
    if(process.argv.includes('--review')) console.log('Review: http://localhost:3212/receipts/'+receipt.id)
  } finally {
    if(!process.argv.includes('--review')) {
      await db.supplierEntry.deleteMany({where:{organizationId,supplierId:supplier.id}})
      await db.serviceRecord.delete({where:{id:order.id}})
      await db.stockMovement.deleteMany({where:{inventoryPartId:{in:parts.map(p=>p.id)}}})
      await db.supplierReceipt.delete({where:{id:receipt.id}})
      await db.inventoryPart.deleteMany({where:{id:{in:parts.map(p=>p.id)}}})
      await db.counterparty.delete({where:{id:supplier.id}})
    }
    await db.$disconnect()
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
