import {PrismaClient} from '../src/generated/prisma/client'
import {PrismaPg} from '@prisma/adapter-pg'
import {chromium} from '@playwright/test'
import {randomBytes,scryptSync} from 'node:crypto'
import {PermissionAction as A,PermissionSubject as S} from '../src/lib/permissions'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url||!/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local DB')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})}),browser=await chromium.launch({headless:true,channel:'chrome'})
 try{
  const owner=await db.user.findUniqueOrThrow({where:{email:'ledger-ui@example.test'}}),member=await db.organizationMember.findFirstOrThrow({where:{userId:owner.id}})
  for(const [kind,subject] of [['finance',S.SUPPLIER_FINANCE],['stock',S.STOCK_LEDGER]] as const){
   const email=`ledger-${kind}-${Date.now()}@example.test`,user=await db.user.create({data:{name:'Read only '+kind,email,emailVerified:true}}),salt=randomBytes(16).toString('hex'),hash=scryptSync('LocalLedgerTest!2026',salt,64,{N:16384,r:16,p:1,maxmem:67108864}).toString('hex')
   await db.account.create({data:{userId:user.id,accountId:user.id,providerId:'credential',password:salt+':'+hash}})
   const role=await db.role.create({data:{organizationId:member.organizationId,name:email,permissions:{create:[{action:A.READ,subject}]}}});await db.organizationMember.create({data:{organizationId:member.organizationId,userId:user.id,roleId:role.id,role:'member'}})
   const c=await browser.newContext({viewport:{width:393,height:852}}),p=await c.newPage();p.setDefaultTimeout(45000)
   const login=await c.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email,password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Role login failed')
   await p.goto('http://localhost:3097/stock-ledger');const nav=p.getByRole('navigation',{name:'Складський облік'})
   if(kind==='finance'){await nav.getByRole('button',{name:'Розрахунки',exact:true}).waitFor();await p.getByLabel('Постачальник',{exact:true}).waitFor();if(await p.getByRole('button',{name:'Зберегти чернетку оплати'}).count())throw new Error('Read-only finance exposes payment entry')}
   else{await p.getByRole('heading',{name:'Залишки за товаром і складом'}).waitFor();await p.getByLabel('Рядків на сторінці залишків').selectOption('50');await p.getByLabel('Пошук товарів у залишках').fill('TEST101');await p.getByText('Фільтр масляний тестовий',{exact:true}).first().waitFor();await p.reload();await p.getByRole('heading',{name:'Залишки за товаром і складом'}).waitFor();if(await p.getByLabel('Рядків на сторінці залишків').inputValue()!=='50')throw new Error('Page size not restored')}
   if(await nav.getByRole('button',{name:'Надходження',exact:true}).count())throw new Error('Cost screen visible without permission')
   const alerts=(await p.getByRole('alert').allTextContents()).filter(t=>t.trim());if(alerts.length)throw new Error('Role screen shows error: '+alerts.join('; '))
   if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Role mobile overflow');await p.screenshot({path:`test-results/stock-ledger/role-${kind}-mobile.png`});await c.close()
  }
  console.log('Docker role screens: finance without stock, stock without cost; normalized SKU search and URL page size passed')
 }finally{await browser.close();await db.$disconnect()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
