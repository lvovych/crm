// Run against docker-compose.ledger.yml after seed + receipt smoke only.
const {chromium}=require('@playwright/test');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const login=await context.request.post('http://localhost:3097/api/public/auth/sign-in/email',{timeout:120000,headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});
  if(login.status()!==200)throw new Error('Local login failed');
  await page.goto('http://localhost:3097/stock-ledger',{timeout:120000,waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Адміністрування',exact:true}).waitFor();
  await page.getByRole('button',{name:'Інвентаризації',exact:true}).click();
  await page.getByLabel('Склад інвентаризації',{exact:true}).selectOption({index:1});
  await page.getByRole('button',{name:'Почати підрахунок',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:/Інвентаризація/}).waitFor();
  const counts=dialog.getByLabel('Фактично',{exact:true});await counts.first().waitFor();
  for(let i=0;i<await counts.count();i++){
   const row=counts.nth(i).locator('xpath=../..');
   const expected=(await row.getByText(/За обліком:/).textContent()).match(/За обліком: ([\d.]+)/)[1];
   await counts.nth(i).fill(expected);
  }
  await dialog.getByRole('button',{name:'Зберегти підрахунок',exact:true}).click();
  await dialog.getByRole('button',{name:'Провести інвентаризацію',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Провести інвентаризацію',exact:true}).click();
  await dialog.getByText(/^Проведено: COUNT/).waitFor();
  require('node:fs').mkdirSync('test-results/stock-ledger',{recursive:true});
  await page.screenshot({path:'test-results/stock-ledger/count-desktop.png',fullPage:true});
  await page.setViewportSize({width:393,height:852});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile page overflow');
  if(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1))throw new Error('Mobile count dialog overflow');
  await page.screenshot({path:'test-results/stock-ledger/count-mobile.png',fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('Docker inventory count: start, save, post and mobile layout passed');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
