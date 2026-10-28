import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { chromium, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createStockLedger } from '../src/features/stock-ledger/Lib/service'
async function main() {
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55440\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated Docker acceptance DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}), browser=await chromium.launch({headless:true,channel:'chrome'})
 try {
 const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}), member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}), organizationId=member.organizationId
 const customer=await db.customer.create({data:{organizationId,userId:user.id,name:'Customer finance UI '+Date.now()}})
 const job=await db.serviceRecord.create({data:{organizationId,customerId:customer.id,title:'Customer ledger UI',financeAccountingMode:'LEDGER',subtotal:10,totalAmount:10,partItems:{create:{name:'Credit test part',quantity:1,unitPrice:10,total:10}}}})
 const account=await createStockLedger(db,{organizationId,userId:user.id}).createAccount({idempotencyKey:randomUUID(),name:'Customer cash '+Date.now()})
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(90000);page.on('dialog',d=>d.accept());const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 const login=await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Login failed')
 await page.goto('http://localhost:3097/sales/'+job.id,{waitUntil:'domcontentloaded'})
 const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Розрахунки за нарядом',exact:true})}).last()
 await panel.getByLabel('Сума, грн',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Take payment',exact:true}).click()
 await expect(panel.getByLabel('Сума, грн',{exact:true})).toBeFocused()
 await panel.getByLabel('Сума, грн',{exact:true}).fill('1.01');await panel.getByRole('combobox',{name:/^Каса \/ рахунок/}).selectOption(account.id)
 await panel.getByRole('button',{name:'Провести операцію',exact:true}).click();await expect(panel.getByText('Аванс / кредит клієнта за всіма нарядами: 1.01 грн',{exact:true})).toBeVisible()
 if((await db.serviceRecord.findUniqueOrThrow({where:{id:job.id}})).billedPartyId)throw new Error('Advance prematurely froze invoice')
 await panel.getByRole('button',{name:'Виставити рахунок',exact:true}).click()
 await panel.getByRole('button',{name:/^Зарахувати аванс від/}).click()
 await expect(panel.getByText('До сплати: 8.99 грн',{exact:true})).toBeVisible()
 await panel.getByRole('combobox',{name:/^Операція/}).waitFor()
 await panel.getByLabel('Сума, грн',{exact:true}).fill('9.00');await panel.getByRole('combobox',{name:/^Каса \/ рахунок/}).selectOption(account.id)
 await panel.getByRole('button',{name:'Провести операцію',exact:true}).click();await expect(panel.getByText('До сплати: 0.00 грн',{exact:true})).toBeVisible()
 await panel.getByRole('combobox',{name:/^Операція/}).selectOption('CREDIT');await panel.getByLabel('Сума, грн',{exact:true}).fill('3.33');await panel.getByLabel('Причина коригування (обов’язково)',{exact:true}).fill('Повернення деталі клієнтом')
 await panel.getByRole('button',{name:'Провести операцію',exact:true}).click();await expect(panel.getByText('Рахунок з коригуваннями: 6.67 грн',{exact:true})).toBeVisible()
 await panel.getByRole('combobox',{name:/^Операція/}).selectOption('OUT');await panel.getByLabel('Сума, грн',{exact:true}).fill('3.34');await panel.getByRole('button',{name:'Провести операцію',exact:true}).click();await expect(panel.getByText('Невикористаний кредит коригувань: 0.00 грн',{exact:true})).toBeVisible()
 const cash=await db.cashLedgerEntry.aggregate({where:{organizationId,accountId:account.id},_sum:{amountDelta:true}});if(cash._sum.amountDelta?.toFixed(2)!=='6.67')throw new Error('Cash mismatch')
 if((await db.serviceRecord.findUniqueOrThrow({where:{id:job.id}})).totalAmount!==10)throw new Error('Frozen invoice changed')
 await page.reload();await panel.getByText('Рахунок з коригуваннями: 6.67 грн',{exact:true}).waitFor();await page.setViewportSize({width:393,height:852});await panel.scrollIntoViewIfNeeded();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow')
 await page.screenshot({path:'test-results/stock-ledger/customer-mobile.png',fullPage:true});if(errors.length)throw new Error(errors.join('\n'))
 console.log('Docker advance-before-invoice, keyboard payment focus, explicit allocation, invoice, credit note, refund, reload and mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
