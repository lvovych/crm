import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes,scryptSync } from 'node:crypto'
async function main(){
 const url=process.env.LEDGER_TEST_DATABASE_URL
 if(!url || !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url))throw new Error('Use isolated local crm_ledger_test database')
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})})
 const user=await db.user.upsert({where:{email:'ledger-ui@example.test'},create:{email:'ledger-ui@example.test',name:'Ledger UI',emailVerified:true},update:{}})
 const salt=randomBytes(16).toString('hex');const hash=scryptSync('LocalLedgerTest!2026',salt,64,{N:16384,r:16,p:1,maxmem:67108864}).toString('hex')
 await db.account.deleteMany({where:{userId:user.id,providerId:'credential'}})
 await db.account.create({data:{userId:user.id,accountId:user.id,providerId:'credential',password:salt+':'+hash}})
 const membership=await db.organizationMember.findFirst({where:{userId:user.id}})
 const org=membership?await db.organization.findUniqueOrThrow({where:{id:membership.organizationId}}):await db.organization.create({data:{name:'Ledger UI isolated'}})
 if(!membership) await db.organizationMember.create({data:{userId:user.id,organizationId:org.id,role:'owner'}})
 if(!await db.inventoryPart.findFirst({where:{organizationId:org.id,partNumber:'TEST-101'}})) await db.inventoryPart.create({data:{userId:user.id,organizationId:org.id,name:'Фільтр масляний тестовий',partNumber:'TEST-101',unit:'pcs'}})
 console.log('Local UI fixture ready');await db.$disconnect()
}
main()
