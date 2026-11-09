import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { saveBrandRecord, setBrandAvailability } from '../src/features/inventory/Lib/saveBrandRecord'
const url = new URL(process.env.DATABASE_URL || '')
assert(['localhost','127.0.0.1'].includes(url.hostname) && (url.pathname.endsWith('_test') || url.pathname === '/torqvoice_e2e'))
const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}).$extends({query:{}})
const name = 'BRAND-QA-' + randomUUID()
async function main() {
 try {
  const save=(data:{id?:string;name:string;isActive:boolean})=>db.$transaction(tx=>saveBrandRecord(tx,data))
  const brand=await save({name,isActive:true}); assert.equal(brand.name,name)
  await assert.rejects(save({name:name.toLowerCase(),isActive:true}),/вже існує/)
  const edited=await save({id:brand.id,name:name+'-EDIT',isActive:false});assert.equal(edited.isActive,false)
  const renamed = await db.$transaction(tx=>saveBrandRecord(tx,{id:brand.id,name:name+'-RENAMED'}))
  assert.equal(renamed.isActive,false)
  assert.equal((await db.$transaction(tx=>setBrandAvailability(tx,brand.id,true))).isActive,true)
  assert.equal((await db.$transaction(tx=>setBrandAvailability(tx,brand.id,false))).isActive,false)
  await assert.rejects(db.$transaction(tx=>setBrandAvailability(tx,'brand_unknown',false)),/Системний/)

  const parallel=await Promise.allSettled([save({name:name+'-RACE',isActive:true}),save({name:name+'-RACE',isActive:true})])
  assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(await db.brand.count({where:{name:{startsWith:name}}}),2)
  console.log('PASS: create/edit brand on real PostgreSQL, case-insensitive duplicate protection and concurrent creation.')
 } finally { await db.brand.deleteMany({where:{name:{startsWith:name}}});await db.$disconnect() }
}
main().catch(e=>{console.error(e);process.exitCode=1})
