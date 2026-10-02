const { Client } = require('pg');
const { randomUUID } = require('node:crypto');
(async () => {
 const db = new Client({ connectionString: process.env.DATABASE_URL });
 await db.connect();
 try {
  await db.query('BEGIN');
  const {rows} = await db.query('SELECT id FROM users WHERE email=$1',['ceo@lauto.com.ua']);
  if(rows.length !== 1) throw new Error('Expected exactly one CEO user');
  const userId=rows[0].id;
  await db.query('UPDATE users SET "isSuperAdmin"=true WHERE id=$1',[userId]);
  let memberships=await db.query('SELECT "organizationId" FROM organization_members WHERE "userId"=$1',[userId]);
  let orgId;
  if(memberships.rows.length===0){
   const count=await db.query('SELECT count(*)::int AS n FROM organizations');
   if(count.rows[0].n!==0) throw new Error('Existing workshop: refusing to create another');
   orgId=randomUUID();
   await db.query('INSERT INTO organizations(id,name,"createdAt","updatedAt") VALUES($1,$2,now(),now())',[orgId,'LAUTO']);
   await db.query('INSERT INTO organization_members(id,role,"userId","organizationId") VALUES($1,$2,$3,$4)',[randomUUID(),'owner',userId,orgId]);
  } else {
   if(memberships.rows.length!==1) throw new Error('Ambiguous workshop membership');
   orgId=memberships.rows[0].organizationId;
   await db.query('UPDATE organization_members SET role=$1 WHERE "userId"=$2 AND "organizationId"=$3',['owner',userId,orgId]);
  }
  for(const [key,value] of Object.entries({'workshop.timezone':'Europe/Kyiv','workshop.currencyCode':'UAH','workshop.currencySymbol':'₴','workshop.email':'ceo@lauto.com.ua'})) {
   await db.query('INSERT INTO app_settings(id,key,value,"userId","organizationId") VALUES($1,$2,$3,$4,$5) ON CONFLICT ("organizationId",key) DO NOTHING',[randomUUID(),key,value,userId,orgId]);
  }
  await db.query('INSERT INTO system_settings(id,key,value) VALUES($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',[randomUUID(),'registration.disabled','true']);
  await db.query('COMMIT');
  console.log('CEO has super administrator and workshop owner roles; public registration disabled.');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
})().catch(e=>{console.error(e.message);process.exit(1)});
