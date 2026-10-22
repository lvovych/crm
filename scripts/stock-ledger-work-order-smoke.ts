import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
async function main() {
  const url=process.env.LEDGER_TEST_DATABASE_URL
  if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local crm_ledger_test database')
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})})
  const browser=await chromium.launch({headless:true,channel:'chrome'})
  try {
    const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}})
    const member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}})
    const part=await db.inventoryPart.findFirstOrThrow({where:{organizationId:member.organizationId,partNumber:'TEST-101'}})
    const balance=await db.stockLotBalance.findFirstOrThrow({where:{organizationId:member.organizationId,onHandQty:{gte:3},reservedQty:0,lot:{inventoryPartId:part.id}}})
    const job=await db.serviceRecord.create({data:{organizationId:member.organizationId,title:'Ledger browser work order',inventoryAccountingMode:'LEDGER',status:'in-progress',partItems:{create:{inventoryPartId:part.id,name:part.name,partNumber:part.partNumber,quantity:2,unitPrice:300,total:600}}}})
    const ctx=await browser.newContext({viewport:{width:1440,height:1000}})
    const page=await ctx.newPage();page.setDefaultTimeout(45000)
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
    const login=await ctx.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}})
    if(login.status()!==200)throw new Error('Local fixture login failed')
    await page.goto('http://localhost:3097/sales/'+job.id,{waitUntil:'domcontentloaded',timeout:120000})
    await page.getByRole('button',{name:'Резерв: 0 · Видано: 0',exact:true}).click()
    await page.getByRole('button',{name:'Резерв',exact:true}).click()
    const reserve=page.getByRole('dialog').last()
    await reserve.getByRole('combobox').selectOption(balance.warehouseId)
    await reserve.getByLabel('Кількість',{exact:true}).fill('2')
    await reserve.getByRole('button',{name:'Підтвердити',exact:true}).click()
    await page.getByText(/Потрібно: 2 · Видано: 0 · Резерв: 2/).waitFor()
    await page.getByRole('button',{name:'Видати',exact:true}).click()
    await page.getByRole('dialog').last().getByLabel('Кількість',{exact:true}).fill('2')
    await page.getByRole('dialog').last().getByRole('button',{name:'Підтвердити',exact:true}).click()
    await page.getByText(/Потрібно: 2 · Видано: 2 · Резерв: 0/).waitFor()
    await page.setViewportSize({width:393,height:852})
    mkdirSync('test-results/stock-ledger',{recursive:true})
    await page.screenshot({path:'test-results/stock-ledger/work-order-mobile.png',fullPage:true})
    if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile overflow')
    if(errors.length)throw new Error('Browser errors: '+errors.join('\n'))
    console.log('Work order reserve/issue/mobile passed')
  }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
