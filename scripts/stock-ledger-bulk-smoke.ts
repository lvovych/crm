import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium} from '@playwright/test'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({headless:true,channel:'chrome'})
 try{
  const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),org=member.organizationId
  const product=await db.inventoryPart.findFirstOrThrow({where:{organizationId:org,partNumber:'TEST-101'}}),balance=await db.stockLotBalance.findFirstOrThrow({where:{organizationId:org,onHandQty:{gte:2},reservedQty:0,lot:{inventoryPartId:product.id}}})
  const title='Bulk UI '+Date.now(),job=await db.serviceRecord.create({data:{organizationId:org,title,status:'in-progress',inventoryAccountingMode:'LEDGER',partItems:{create:[{name:'Bulk filter A',inventoryPartId:product.id,quantity:1},{name:'Bulk filter B',inventoryPartId:product.id,quantity:1}]}}})
  const c=await browser.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage(),errors:string[]=[];p.setDefaultTimeout(120000);p.on('pageerror',e=>errors.push(e.message))
  await c.request.post('http://localhost:3097/api/public/auth/sign-in/email',{timeout:120000,headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}})
  await p.goto('http://localhost:3097/stock-ledger',{timeout:180000,waitUntil:'domcontentloaded'});await p.getByRole('button',{name:'Адміністрування',exact:true}).waitFor();await p.getByRole('button',{name:'Потреби нарядів',exact:true}).click();await p.getByLabel('Пошук потреб за нарядом').fill(title);await p.getByText('Bulk filter B',{exact:true}).waitFor()
  for(const action of ['reserve','issue']){
   await p.getByRole('button',{name:'Обробити кілька позицій',exact:true}).click();const dialog=p.getByRole('dialog').last();await dialog.getByLabel('Масова дія').selectOption(action);await dialog.getByLabel('Склад масової дії').selectOption(balance.warehouseId);await dialog.getByRole('button',{name:'Перевірити вибрані позиції'}).click();await dialog.getByText('Перевірено 2 позицій',{exact:true}).waitFor();
   const before=await db.stockDemand.count({where:{serviceRecordId:job.id}});if(action==='reserve'&&before!==0)throw new Error('Preview persisted demand')
   await p.setViewportSize({width:393,height:852});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Bulk mobile overflow');await p.screenshot({path:`test-results/stock-ledger/bulk-${action}-mobile.png`,fullPage:true});await dialog.getByRole('button',{name:'Підтвердити всі позиції'}).click();await dialog.waitFor({state:'hidden'});await p.setViewportSize({width:1440,height:1000});
  }
  const demand=await db.stockDemand.findMany({where:{serviceRecordId:job.id},include:{stockReservation_demand:true}});if(demand.length!==2||demand.some(d=>d.stockReservation_demand.some(r=>!r.remainingQuantity.isZero())))throw new Error('Reservations not consumed')
  await p.getByRole('button',{name:'Звіти на дату',exact:true}).click();await p.getByRole('button',{name:'Акт звірки',exact:true}).first().click();await p.getByRole('dialog').getByText(/Початкове сальдо/).waitFor();await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'Адміністрування',exact:true}).click();await p.getByRole('button',{name:'Виконати звірку',exact:true}).click();await p.getByText('Склад, резерви, каси й розрахунки відповідають документам',{exact:true}).waitFor();
  if(errors.length)throw new Error(errors.join('\n'));console.log('Docker bulk reserve/issue, rollback-only preview, period statement and full reconciliation passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
