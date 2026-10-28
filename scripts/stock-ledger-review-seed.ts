/** Synthetic user-review fixture; refuses all databases except the isolated acceptance stack. */
import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {randomBytes,randomUUID,scryptSync} from 'node:crypto'
import {createStockLedger} from '../src/features/stock-ledger/Lib/service'
import {createStockOperations} from '../src/features/stock-ledger/Lib/stock'
import {applyMigrationBatch,migrationChecksum} from '../src/features/stock-ledger/Lib/migrationBatch'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):55440\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Isolated acceptance DB only')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})})
 try{
 const email='demo@lauto.test'
 if(await db.user.findUnique({where:{email}})){console.log('Review account already exists; data preserved');return}
 const salt=randomBytes(16).toString('hex'),password=salt+':'+scryptSync('DemoLedger!2026',salt,64,{N:16384,r:16,p:1,maxmem:67108864}).toString('hex')
 const user=await db.user.create({data:{email,name:'Демо адміністратор',emailVerified:true,accounts:{create:{providerId:'credential',accountId:email,password}}}}),org=await db.organization.create({data:{name:'LAUTO — локальна демонстрація'}}),ctx={organizationId:org.id,userId:user.id},ledger=createStockLedger(db,ctx),stock=createStockOperations(db,ctx)
 await db.organizationMember.create({data:{userId:user.id,organizationId:org.id,role:'owner'}})
 for(const [key,value] of Object.entries({'workshop.currencyCode':'UAH','workshop.currencySymbol':'грн','workshop.locale':'uk'}))await db.appSetting.create({data:{...ctx,key,value}})
 const warehouse=await ledger.createWarehouse({idempotencyKey:randomUUID(),name:'Основний склад',code:'MAIN'}),account=await ledger.createAccount({idempotencyKey:randomUUID(),name:'Демо каса',kind:'CASH'}),supplier=await ledger.createSupplier({idempotencyKey:randomUUID(),name:'Демо Автозапчастини',paymentTermsDays:14,kind:'BOTH'})
 await ledger.createWarehouse({idempotencyKey:randomUUID(),name:'Резервний склад',code:'SECOND'})
 await ledger.createSupplier({idempotencyKey:randomUUID(),name:'Демо ремонт агрегатів',kind:'SERVICES'})
 const products=[]
 for(const [name,partNumber,unitCost,sellPrice] of [['Фільтр масляний','DEMO-FILTER',200,300],['Олива моторна 5W-30','DEMO-OIL',250,350],['Колодки гальмівні, комплект','DEMO-BRAKE',1000,1500]] as const) products.push(await db.inventoryPart.create({data:{...ctx,name,partNumber,unitCost,sellPrice,unit:partNumber==='DEMO-OIL'?'l':'pcs',quantity:0,minQuantity:2}}))
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv'}).format(new Date())
 const manifest={version:1 as const,effectiveDate:date,sourceChecksum:'d'.repeat(64),stock:[{warehouseId:warehouse.id,lines:products.slice(0,2).map(p=>({inventoryPartId:p.id,quantity:'10',unitPrice:String(p.unitCost),expectedLegacyQuantity:'0'}))}],balances:[{accountId:account.id,amount:'10000',note:'Синтетичний залишок демонстраційної каси'}],jobs:[],activate:true}
 await applyMigrationBatch(db,ctx,{idempotencyKey:randomUUID(),manifest,checksum:migrationChecksum(manifest),confirmed:true})
 const customer=await db.customer.create({data:{...ctx,name:'Демонстраційний клієнт'}}),vehicle=await db.vehicle.create({data:{...ctx,customerId:customer.id,make:'Renault',model:'Master',year:2017,licensePlate:'ДЕМО 001'}})
 const job=await db.serviceRecord.create({data:{organizationId:org.id,customerId:customer.id,vehicleId:vehicle.id,title:'Демо — ТО та гальма',invoiceNumber:'DEMO-001',status:'in-progress',inventoryAccountingMode:'LEDGER',financeAccountingMode:'LEDGER',subtotal:2500,totalAmount:2500,partItems:{create:[{organizationId:org.id,inventoryPartId:products[0].id,name:products[0].name,partNumber:products[0].partNumber,quantity:2,unitPrice:300,total:600,unit:'pcs'},{organizationId:org.id,inventoryPartId:products[2].id,name:products[2].name,partNumber:products[2].partNumber,quantity:1,unitPrice:1500,total:1500,unit:'pcs'}]},laborItems:{create:{description:'Технічне обслуговування',hours:1,rate:400,total:400}}},include:{partItems:true}})
 for(const part of job.partItems){const demand=await stock.createDemand({idempotencyKey:randomUUID(),servicePartId:part.id});if(part.inventoryPartId===products[0].id)await stock.reserve({idempotencyKey:randomUUID(),demandId:demand.id,warehouseId:warehouse.id,quantity:'2',effectiveAt:date})}
 const receipt=await ledger.saveReceiptDraft({idempotencyKey:randomUUID(),supplierId:supplier.id,warehouseId:warehouse.id,effectiveAt:date,externalDate:date,dueDate:date,externalNumber:'DEMO-IN-001',lines:[{inventoryPartId:products[0].id,quantity:'5',unitPrice:'210'}]})
 await ledger.postReceipt({idempotencyKey:randomUUID(),documentId:receipt.id,expectedVersion:1})
 console.log(JSON.stringify({ready:true,jobId:job.id,vehicleId:vehicle.id,organizationId:org.id}))
 }finally{await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
