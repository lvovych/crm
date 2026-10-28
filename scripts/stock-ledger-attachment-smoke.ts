import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
import {subcontractOperations} from '../src/features/stock-ledger/Lib/subcontracts'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55440\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated Docker DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),ctx={organizationId:member.organizationId,userId:user.id},ledger=createStockLedger(db,ctx)
  const supplier=await ledger.createSupplier({idempotencyKey:randomUUID(),name:'Files '+Date.now(),kind:'BOTH'}),warehouse=await db.warehouse.findFirstOrThrow({where:{organizationId:ctx.organizationId,isDefault:true}}),product=await db.inventoryPart.create({data:{organizationId:ctx.organizationId,userId:user.id,name:'Attachment product'}}),account=await ledger.createAccount({idempotencyKey:randomUUID(),name:'Files bank'})
  const receipt=await ledger.saveReceiptDraft({idempotencyKey:randomUUID(),supplierId:supplier.id,warehouseId:warehouse.id,effectiveAt:'2026-10-20',externalDate:'2026-10-20',dueDate:'2026-10-20',externalNumber:randomUUID(),lines:[{inventoryPartId:product.id,quantity:'1',unitPrice:'10'}]}),payment=await ledger.postMoneyTransaction({idempotencyKey:randomUUID(),partyId:supplier.partyId,accountId:account.id,direction:'OUT',amount:'10',effectiveAt:'2026-10-20',method:'bank'})
  const job=await db.serviceRecord.create({data:{organizationId:ctx.organizationId,title:'Files work',inventoryAccountingMode:'LEDGER',status:'in-progress',laborItems:{create:{description:'Attachment work',executionType:'SUBCONTRACT',pricingType:'service',hours:1,rate:10,total:10}}},include:{laborItems:true}})
  const act=await subcontractOperations(db,ctx).save({idempotencyKey:randomUUID(),supplierId:supplier.id,effectiveAt:'2026-10-20',dueDate:'2026-10-20',externalNumber:randomUUID(),lines:[{serviceRecordId:job.id,serviceLaborId:job.laborItems[0].id,description:'Repair',quantity:'1',unitCost:'10'}]})
  const context=await browser.newContext({viewport:{width:393,height:852}}),page=await context.newPage();page.setDefaultTimeout(60000)
  const login=await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Login failed')
  for(const [kind,id] of [['receipt',receipt.id],['payment',payment.id]] as const){
   const endpoint=`http://localhost:3097/api/protected/stock-ledger/attachments/${kind}/${id}`,key=randomUUID(),multipart={file:{name:'proof.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-local-proof')},idempotencyKey:key}
   const response=await context.request.post(endpoint,{headers:{Origin:'http://localhost:3097'},multipart}),result=await response.json();if(response.status()!==201)throw new Error(JSON.stringify(result))
   const retry=await context.request.post(endpoint,{headers:{Origin:'http://localhost:3097'},multipart});if((await retry.json()).data.id!==result.data.id)throw new Error('Duplicate attachment')
   const download=await context.request.get(endpoint+'?file='+result.data.id);if((await download.body()).toString()!=='%PDF-local-proof')throw new Error('Download content mismatch')
   if((await context.request.post(endpoint,{headers:{Origin:'https://foreign.invalid'},multipart})).status()!==403)throw new Error('CSRF not rejected')
   const anonymous=await browser.newContext();if((await anonymous.request.get(endpoint+'?file='+result.data.id)).status()===200)throw new Error('Anonymous access');await anonymous.close()
  }
  await page.goto('http://localhost:3097/sales/'+job.id)
  for(let attempt=0;attempt<8;attempt++){await page.getByRole('button',{name:'Attachment work',exact:true}).first().click();if(await page.getByRole('dialog').count())break;await page.waitForTimeout(500)}
  const dialog=page.getByRole('dialog').last();await dialog.locator('summary',{hasText:'Вкладення документа'}).click();await dialog.getByLabel('Файл документа').setInputFiles({name:'act.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-ui-act')});await dialog.getByRole('button',{name:'Додати вкладення',exact:true}).click();await expect(dialog.getByRole('link',{name:/act.pdf/})).toBeVisible()
  const attached=await db.ledgerAttachment.findFirstOrThrow({where:{supplierServiceDocumentId:act.id}});if(attached.name!=='act.pdf')throw new Error('UI upload missing')
  await page.screenshot({path:'test-results/stock-ledger/attachment-mobile.png'});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Overflow')
  console.log('Docker attachment upload/download/retry/CSRF/anonymous protection and mobile subcontract upload passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
