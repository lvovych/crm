import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium} from '@playwright/test'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
import {createProcurement} from '../src/features/stock-ledger/Lib/procurement'
import {randomUUID as key} from 'node:crypto'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({headless:true,channel:'chrome'})
 try{
  const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),ctx={organizationId:member.organizationId,userId:user.id},service=createStockLedger(db,ctx),procurement=createProcurement(db,ctx),suffix=Date.now().toString()
  const supplier=await service.createSupplier({idempotencyKey:key(),name:'Cost UI '+suffix}),warehouse=await db.warehouse.findFirstOrThrow({where:{organizationId:ctx.organizationId,archivedAt:null}}),product=await db.inventoryPart.findFirstOrThrow({where:{organizationId:ctx.organizationId,partNumber:'TEST-101'}})
  const po=await procurement.saveDraft({idempotencyKey:key(),supplierId:supplier.id,warehouseId:warehouse.id,lines:[{inventoryPartId:product.id,quantity:'2',unitPrice:'10'}]});await procurement.confirm({idempotencyKey:key(),documentId:po.id,expectedVersion:1})
  const c=await browser.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage(),errors:string[]=[];p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept())
  await c.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}})
  await p.goto('http://localhost:3097/stock-ledger');await p.getByRole('button',{name:'Закупівлі',exact:true}).click();const card=p.locator('article').filter({hasText:'Cost UI '+suffix});await card.getByRole('button',{name:'Змінити замовлену кількість'}).click();let dialog=p.getByRole('dialog');await dialog.getByLabel('Нова загальна кількість').fill('3');await dialog.getByLabel('Причина зміни').fill('Supplier delivered an extra item');await dialog.getByRole('button',{name:'Зберегти зміну з аудитом'}).click();await dialog.waitFor({state:'hidden'});await card.getByText('Замовлено: 3 · Отримано: 0',{exact:true}).waitFor()
  await card.getByRole('button',{name:'Прийняти частково'}).click();dialog=p.getByRole('dialog');await dialog.getByLabel('Номер накладної',{exact:true}).fill('COST-'+suffix);await dialog.getByRole('button',{name:'Створити чернетку',exact:true}).click();await dialog.waitFor({state:'hidden'})
  await p.getByRole('button',{name:'Надходження',exact:true}).click();await p.getByText('COST-'+suffix,{exact:true}).click();await p.getByText('Доставка, округлення та сума накладної',{exact:true}).click();await p.getByLabel('Додаткові витрати цього постачальника, грн').fill('2');await p.getByLabel('Округлення документа, грн').fill('-0.01');await p.getByLabel('Причина округлення').fill('Supplier invoice rounding');await p.getByLabel('Підсумок у накладній, грн').fill('31.99');await p.getByRole('button',{name:'Зберегти чернетку',exact:true}).click();await p.getByText('Чернетку збережено',{exact:true}).waitFor()
  await p.setViewportSize({width:393,height:852});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Receipt cost mobile overflow');await p.screenshot({path:'test-results/stock-ledger/receipt-cost-mobile.png'});await p.getByRole('button',{name:'Провести збережену чернетку',exact:true}).click();await p.getByRole('heading',{name:'Надходження — проведено',exact:true}).waitFor()
  const doc=await db.inventoryDocument.findFirstOrThrow({where:{organizationId:ctx.organizationId,externalNumber:'COST-'+suffix}}),entry=await db.settlementEntry.findFirstOrThrow({where:{inventoryDocumentId:doc.id}}),stock=await db.inventoryLedgerEntry.aggregate({where:{documentLine:{documentId:doc.id}},_sum:{costAmountDelta:true}})
  if(entry.amount.toFixed(2)!=='31.99'||stock._sum.costAmountDelta?.toFixed(2)!=='32.00')throw new Error('Cost/AP mismatch')
  if(errors.length)throw new Error(errors.join('\n'));console.log('Docker amended purchase 2→3, receipt cost 32.00, AP 31.99 and mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
