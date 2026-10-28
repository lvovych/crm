import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({headless:true,channel:'chrome'})
 try{
  const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),org=member.organizationId
  const supplier=await createStockLedger(db,{organizationId:org,userId:user.id}).createSupplier({idempotencyKey:randomUUID(),name:'UI contractor '+Date.now(),kind:'SERVICES'})
  const job=await db.serviceRecord.create({data:{organizationId:org,title:'UI subcontract',inventoryAccountingMode:'LEDGER',status:'in-progress',laborItems:{create:{description:'External cylinder repair',executionType:'SUBCONTRACT',pricingType:'service',hours:1,rate:3800,total:3800}}},include:{laborItems:true}})
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept(d.type()==='prompt'?'Test reversal reason':undefined))
  const login=await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{timeout:120000,headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Local login failed')
  await page.goto('http://localhost:3097/sales/'+job.id,{waitUntil:'domcontentloaded',timeout:180000})
  // The work description is an edit button in the compact service table.
  for(let attempt=0;attempt<12;attempt++){await page.getByRole('button',{name:'External cylinder repair',exact:true}).first().click();if(await page.getByRole('dialog').count())break;await page.waitForTimeout(1000)}
  const dialog=page.getByRole('dialog').last();await dialog.waitFor();await page.screenshot({path:'test-results/stock-ledger/subcontract-debug.png'});await dialog.getByLabel('Підрядник роботи').selectOption(supplier.id)
  await dialog.getByLabel('Номер акта підрядника').fill('ACT-'+Date.now());await dialog.getByLabel('Закупівельна сума, грн').fill('3000')
  await dialog.getByLabel('Податок підрядника').selectOption('EXCLUSIVE');await dialog.getByLabel('Ставка податку, %').fill('20')
  await dialog.getByRole('button',{name:'Зберегти чернетку акта',exact:true}).click();await dialog.getByText('Чернетка',{exact:true}).waitFor()
  const draft=await db.supplierServiceLine.findFirstOrThrow({where:{serviceLaborId:job.laborItems[0].id}})
  if(await db.settlementEntry.count({where:{supplierServiceDocumentId:draft.documentId}}))throw new Error('Draft created AP')
  await dialog.getByRole('button',{name:'Редагувати чернетку',exact:true}).click();await dialog.getByLabel('Закупівельна сума, грн').fill('2500');await dialog.getByRole('button',{name:'Зберегти чернетку акта',exact:true}).click()
  await expect.poll(async()=>(await db.supplierServiceDocument.findUniqueOrThrow({where:{id:draft.documentId}})).version).toBe(2)
  await dialog.getByRole('button',{name:'Провести акт',exact:true}).click();await dialog.getByText('Проведено',{exact:true}).waitFor()
  const posted=await db.supplierServiceLine.findFirstOrThrow({where:{serviceLaborId:job.laborItems[0].id}});if(posted.totalAmount.toString()!=='3000')throw new Error('Wrong purchase cost')
  await dialog.getByRole('button',{name:'Сторнувати акт',exact:true}).click();await dialog.getByText('Сторновано',{exact:true}).waitFor()
  if(await db.supplierServiceDocument.count({where:{reversalOfId:posted.documentId}})!==1)throw new Error('Missing reversal')
  if((await db.serviceLabor.findUniqueOrThrow({where:{id:job.laborItems[0].id}})).total!==3800)throw new Error('Sale price changed')
  await page.setViewportSize({width:393,height:852});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');await expect.poll(async()=>{const b=await dialog.boundingBox();return !!b && b.x>=-1 && b.y>=-1 && b.x+b.width<=394 && b.y+b.height<=853}).toBe(true);await page.screenshot({path:'test-results/stock-ledger/subcontract-mobile.png'})
  if(errors.length)throw new Error(errors.join('\n'));console.log('Docker subcontract draft/edit, tax 500 + cost 2500, AP 3000, reversal, sale 3800 unchanged, mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
