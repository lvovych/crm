import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium,expect} from '@playwright/test'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
import {createFinance} from '../src/features/stock-ledger/Lib/finance'
import {randomUUID as key} from 'node:crypto'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({headless:true,channel:'chrome'})
 try{
  const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),ctx={organizationId:member.organizationId,userId:user.id},service=createStockLedger(db,ctx),finance=createFinance(db,ctx)
  const supplier=await service.createSupplier({idempotencyKey:key(),name:'Payment UI '+Date.now()}),party=await db.settlementParty.findFirstOrThrow({where:{supplierId:supplier.id}}),account=await service.createAccount({idempotencyKey:key(),name:'Payment UI bank '+Date.now()})
  for(const amount of ['0.01','0.02'])await finance.openingBalance({idempotencyKey:key(),partyId:party.id,side:'AP',polarity:'DEBIT',amount,effectiveAt:'2026-10-20',sourceNote:'Browser acceptance opening',batchKey:key()})
  const c=await browser.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage(),errors:string[]=[];p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept())
  const login=await c.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Login failed')
  await p.goto('http://localhost:3097/stock-ledger');await p.getByRole('button',{name:'Розрахунки',exact:true}).click();const partySelect=p.getByLabel('Постачальник',{exact:true})
  const otherParty=await partySelect.locator('option').evaluateAll((options,target)=>options.map(o=>(o as HTMLOptionElement).value).find(id=>id!==target),party.id)
  if(!otherParty)throw new Error('Seed a second supplier before payment smoke')
  if(await partySelect.inputValue()!==otherParty){
   const loaded=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/stock-ledger')
   await partySelect.selectOption(otherParty);await loaded
  }
  await expect(p.getByRole('heading',{name:'Оплата: чернетка та проведення',exact:true})).toBeVisible()
  await p.route('**/stock-ledger**',async route=>{
   if(route.request().method()==='POST')await new Promise(resolve=>setTimeout(resolve,500))
   await route.continue()
  },{times:1})
  await partySelect.selectOption(party.id)
  await expect(p.getByRole('status').filter({hasText:'Завантаження розрахунків постачальника'})).toBeVisible()
  await expect(p.getByRole('button',{name:'Зберегти чернетку оплати'})).toHaveCount(0)
  await expect(p.getByRole('heading',{name:'Оплата: чернетка та проведення',exact:true})).toBeVisible()
  await p.getByLabel('Рахунок чернетки оплати').selectOption(account.id);await p.getByLabel('Сума оплати, грн').fill('0,04');await p.getByRole('button',{name:'Зберегти чернетку оплати'}).click();await p.getByText('Чернетку оплати збережено',{exact:true}).waitFor()
  const draft=await db.moneyTransaction.findFirstOrThrow({where:{partyId:party.id,status:'DRAFT'}});if(await db.cashLedgerEntry.count({where:{moneyTransactionId:draft.id}}))throw new Error('Draft affected cash')
  await p.getByRole('button',{name:'Провести збережену оплату'}).click();await p.getByRole('button',{name:'Рознести на кілька документів'}).waitFor({state:'visible'});await p.getByRole('button',{name:'Рознести на кілька документів'}).click();const dialog=p.getByRole('dialog')
  const credit=await db.settlementEntry.findFirstOrThrow({where:{moneyTransactionId:draft.id}});await dialog.getByLabel('Оплата для рознесення').selectOption(credit.id);await dialog.getByRole('button',{name:'Перевірити рознесення'}).click();await dialog.getByRole('button',{name:'Підтвердити рознесення'}).waitFor()
  await p.setViewportSize({width:393,height:852});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Payment mobile overflow');await p.screenshot({path:'test-results/stock-ledger/payment-allocation-mobile.png',fullPage:true});await dialog.getByRole('button',{name:'Підтвердити рознесення'}).click();await dialog.waitFor({state:'hidden'})
  const used=await db.settlementAllocation.aggregate({where:{creditEntryId:credit.id,reversedAt:null},_sum:{amount:true}});if(used._sum.amount?.toFixed(2)!=='0.03')throw new Error('Allocation amount mismatch');if(await db.cashLedgerEntry.count({where:{moneyTransactionId:draft.id}})!==1)throw new Error('Duplicate cash')
  if(errors.length)throw new Error(errors.join('\n'));console.log('Docker payment draft: zero effect; posting once; two-document allocation 0.03, advance 0.01; mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
