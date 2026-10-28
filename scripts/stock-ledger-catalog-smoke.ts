import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55440\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated Docker acceptance DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const user=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:user.id}}),organizationId=member.organizationId,ctx={organizationId,userId:user.id},stamp=Date.now().toString()
  const warehouse=await db.warehouse.findFirstOrThrow({where:{organizationId,isDefault:true,archivedAt:null}}),supplier=await createStockLedger(db,ctx).createSupplier({idempotencyKey:randomUUID(),name:'Catalog supplier '+stamp})
  const product=await db.inventoryPart.create({data:{organizationId,userId:user.id,name:'Catalog UI '+stamp,partNumber:'CAT-'+stamp,unit:'pcs',minQuantity:1}})
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  const login=await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Login failed')
  await page.goto('http://localhost:3097/stock-ledger?view=directories')
  const manager=page.locator('details').filter({has:page.locator('summary',{hasText:'Одиниці виміру та місця зберігання'})})
  await manager.locator('summary').click();await manager.getByLabel('Код',{exact:true}).fill('dose'+stamp);await manager.getByLabel('Назва',{exact:true}).fill('UI dose '+stamp);await manager.getByLabel('Знаків після крапки',{exact:true}).fill('2');await manager.getByRole('button',{name:'Додати запис',exact:true}).click()
  await expect(manager.getByText('dose'+stamp+' · UI dose '+stamp+' · точність 2',{exact:true})).toBeVisible()
  const unit=await db.unitOfMeasure.findUniqueOrThrow({where:{organizationId_code:{organizationId,code:'dose'+stamp}}})
  await manager.getByLabel('Тип складського довідника',{exact:true}).selectOption('location');await manager.getByLabel('Код',{exact:true}).fill('A-'+stamp);await manager.getByLabel('Назва',{exact:true}).fill('UI shelf');await manager.getByLabel('Склад місця зберігання',{exact:true}).selectOption(warehouse.id);await manager.getByRole('button',{name:'Додати запис',exact:true}).click()
  await expect(manager.getByText(warehouse.name+' / A-'+stamp+' · UI shelf',{exact:true})).toBeVisible()
  const location=await db.warehouseLocation.findUniqueOrThrow({where:{organizationId_warehouseId_code:{organizationId,warehouseId:warehouse.id,code:'A-'+stamp}}})
  await page.goto('http://localhost:3097/stock-ledger?view=overview&stockSearch='+encodeURIComponent(product.name));await page.getByRole('button',{name:'Історія рухів',exact:true}).click()
  const dialog=page.getByRole('dialog'),catalog=dialog.locator('details').filter({has:page.locator('summary',{hasText:'Постачальники, одиниця та місце зберігання'})})
  await catalog.locator('summary').click();await catalog.getByLabel('Одиниця товару',{exact:true}).selectOption(unit.id);await catalog.getByLabel('Місце зберігання товару',{exact:true}).selectOption(location.id);await catalog.getByRole('button',{name:'Зберегти параметри товару',exact:true}).click()
  await expect.poll(async()=>(await db.inventoryPart.findUniqueOrThrow({where:{id:product.id}})).unitId).toBe(unit.id)
  await catalog.getByLabel('Постачальник товару',{exact:true}).selectOption(supplier.id);await catalog.getByLabel('Артикул постачальника',{exact:true}).fill('SUP-'+stamp);await catalog.getByLabel('Ціна пропозиції, грн',{exact:true}).fill('12.345678');await catalog.getByLabel('Строк поставки, днів',{exact:true}).fill('3');await catalog.getByLabel('Основний постачальник',{exact:true}).check();await catalog.getByRole('button',{name:'Зберегти пропозицію',exact:true}).click()
  await expect(catalog.getByRole('button',{name:'Редагувати пропозицію',exact:true})).toBeVisible()
  const mapping=await db.supplierProduct.findFirstOrThrow({where:{organizationId,inventoryPartId:product.id,supplierId:supplier.id}})
  if(mapping.lastQuotedPrice?.toFixed(6)!=='12.345678'||!mapping.preferred)throw new Error('Supplier mapping mismatch')
  await page.setViewportSize({width:393,height:852});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow');await expect.poll(async()=>dialog.evaluate(el=>{const box=el.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight}),{message:'Dialog stays inside the resized viewport'}).toBe(true);await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:'test-results/stock-ledger/catalog-mobile.png'})
  if(errors.length)throw new Error(errors.join('\n'));console.log('Docker unit precision, warehouse location, product configuration, supplier SKU/price, mobile passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
