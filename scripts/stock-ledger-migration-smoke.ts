import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium,expect} from '@playwright/test'
import {randomUUID,randomBytes,scryptSync} from 'node:crypto'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55440\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated Docker DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const email='migration-'+randomUUID()+'@example.test',user=await db.user.create({data:{name:'Migration owner',email,emailVerified:true}}),org=await db.organization.create({data:{name:'Migration UI'}}),salt=randomBytes(16).toString('hex'),hash=scryptSync('LocalLedgerTest!2026',salt,64,{N:16384,r:16,p:1,maxmem:67108864}).toString('hex')
  await db.account.create({data:{userId:user.id,accountId:user.id,providerId:'credential',password:salt+':'+hash}});await db.organizationMember.create({data:{organizationId:org.id,userId:user.id,role:'owner'}})
  const ctx={organizationId:org.id,userId:user.id},ledger=createStockLedger(db,ctx),warehouse=await ledger.createWarehouse({idempotencyKey:randomUUID(),code:'MIG',name:'Migration warehouse'}),product=await db.inventoryPart.create({data:{organizationId:org.id,userId:user.id,name:'Migration part',quantity:5,unit:'pcs'}}),customer=await db.customer.create({data:{organizationId:org.id,userId:user.id,name:'Migration customer'}})
  const job=await db.serviceRecord.create({data:{organizationId:org.id,title:'Migration job',status:'in-progress',customerId:customer.id,totalAmount:100,subtotal:100,laborItems:{create:{description:'Repair',hours:1,rate:100,total:100}}}})
  await db.payment.create({data:{serviceRecordId:job.id,amount:30,method:'cash'}})
  const manifest={version:1,effectiveDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv'}).format(new Date()),sourceChecksum:'a'.repeat(64),stock:[{warehouseId:warehouse.id,lines:[{inventoryPartId:product.id,quantity:'5',unitPrice:'10',expectedLegacyQuantity:'5'}]}],balances:[],jobs:[{id:job.id,expectedUpdatedAt:job.updatedAt.toISOString(),expectedTotal:'100',expectedPaid:'30',expectedManuallyPaid:false,parts:[]}],activate:true}
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('dialog',d=>d.accept())
  const login=await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email,password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Login failed')
  await page.goto('http://localhost:3097/stock-ledger?view=administration')
  const manager=page.locator('details').filter({has:page.locator('summary',{hasText:'Перехід зі старого обліку'})});await manager.locator('summary').first().click();await manager.getByLabel('Пакет міграції').setInputFiles({name:'manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await manager.getByRole('button',{name:'Перевірити без збереження',exact:true}).click();await expect(manager.getByText(/Контрольна сума:/)).toBeVisible()
  if(await db.ledgerMigrationBatch.count({where:{organizationId:org.id}}))throw new Error('Preview wrote batch')
  await manager.getByRole('checkbox').check();await manager.getByRole('button',{name:'Застосувати пакет',exact:true}).click();await expect(manager.getByRole('status')).toContainText('Пакет застосовано')
  if(await db.cashLedgerEntry.count({where:{organizationId:org.id}}))throw new Error('Historical payment duplicated cash')
  if((await db.stockLotBalance.aggregate({where:{organizationId:org.id},_sum:{onHandQty:true}}))._sum.onHandQty?.toString()!=='5')throw new Error('Opening mismatch')
  await page.setViewportSize({width:393,height:852});await page.screenshot({path:'test-results/stock-ledger/migration-mobile.png'});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Overflow')
  await page.goto('http://localhost:3097/sales/'+job.id);await expect(page.getByRole('heading',{name:'Розрахунки за нарядом',exact:true})).toBeVisible()
  console.log('Docker migration preview rollback, confirmed package, coherent cutover, preserved opening and historical cash, mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
