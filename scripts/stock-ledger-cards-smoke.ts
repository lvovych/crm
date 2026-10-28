import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { chromium,expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createStockLedger } from '../src/features/stock-ledger/Lib/service'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55440\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Isolated Docker DB only')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({channel:'chrome',headless:true})
 try{
 const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),membership=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),ctx={organizationId:membership.organizationId,userId:user.id},ledger=createStockLedger(db,ctx),stamp=Date.now().toString()
 const supplier=await ledger.createSupplier({idempotencyKey:randomUUID(),name:'Card supplier '+stamp}),warehouse=await db.warehouse.findFirstOrThrow({where:{organizationId:ctx.organizationId,isDefault:true}}),product=await db.inventoryPart.create({data:{organizationId:ctx.organizationId,userId:user.id,name:'Card product '+stamp,partNumber:'CARD-'+stamp,unit:'pcs'}})
 const draft=await ledger.saveReceiptDraft({idempotencyKey:randomUUID(),supplierId:supplier.id,warehouseId:warehouse.id,effectiveAt:'2026-10-23',externalDate:'2026-10-23',dueDate:'2026-10-23',externalNumber:stamp,lines:[{inventoryPartId:product.id,quantity:'2',unitPrice:'10'}]});await ledger.postReceipt({idempotencyKey:randomUUID(),documentId:draft.id,expectedVersion:1})
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:user.email,password:'LocalLedgerTest!2026'}})
 await page.goto('http://localhost:3097/stock-ledger?view=overview&stockSearch='+encodeURIComponent(product.name));await page.getByRole('button',{name:'Історія рухів',exact:true}).click()
 let dialog=page.getByRole('dialog');await expect(dialog.getByText('Разом на складі',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Партії',exact:true}).click();await expect(dialog.getByText(/Кількість: 2.000/)).toBeVisible();await dialog.getByRole('button',{name:'Резерви',exact:true}).click();await expect(dialog.getByText('Записів немає.',{exact:true})).toBeVisible()
 await page.setViewportSize({width:393,height:852});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Product overflow');await page.screenshot({path:'test-results/stock-ledger/product-card-mobile.png'})
 await page.goto('http://localhost:3097/stock-ledger?view=directories');await page.getByLabel('Пошук у довідниках',{exact:true}).fill('Card supplier '+stamp);await page.getByRole('button',{name:'Картка постачальника',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.getByText(/Борг: 20.00 грн/)).toBeVisible()
 for(const tab of ['Послуги','Замовлення','Оплати']){await dialog.getByRole('button',{name:tab,exact:true}).click();await expect(dialog.getByText('Документів немає.',{exact:true})).toBeVisible()}
 await dialog.getByRole('button',{name:'Надходження',exact:true}).click();await expect(dialog.getByText((await db.inventoryDocument.findUniqueOrThrow({where:{id:draft.id}})).number,{exact:true})).toBeVisible();await dialog.locator('summary').filter({hasText:'Вкладення документа'}).click();await expect(dialog.locator('input[type=file]')).toBeVisible()
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Supplier overflow');await page.screenshot({path:'test-results/stock-ledger/supplier-card-mobile.png'});if(errors.length)throw new Error(errors.join('\n'));console.log('Docker product balances/lots/reserves and supplier document tabs, attachments, debt and mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
