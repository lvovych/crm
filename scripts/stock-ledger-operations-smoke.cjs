// Uses only the seeded isolated local server, never production.
const {chromium}=require('@playwright/test');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(45000);
  const login=await ctx.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});
  if(login.status()!==200)throw new Error('Login failed');
  await page.goto('http://localhost:3097/stock-ledger',{timeout:120000,waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Адміністрування',exact:true}).waitFor();
  await page.getByRole('button',{name:'Довідники',exact:true}).click();
  const name='Operations '+Date.now();
  await page.getByLabel('Назва',{exact:true}).fill(name);await page.getByRole('button',{name:'Створити',exact:true}).click();
  const row=page.locator('div.rounded.border').filter({hasText:name}).filter({has:page.getByRole('button',{name:'Редагувати',exact:true})});
  await row.getByRole('button',{name:'Редагувати',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Назва',{exact:true}).fill(name+' edited');await dialog.getByRole('button',{name:'Зберегти зміни'}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Залишки',exact:true}).click();await page.getByRole('heading',{name:'Залишки за товаром і складом'}).waitFor();
  await page.getByLabel('Пошук товарів у залишках').fill('TEST-101');
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('stockSearch')==='TEST-101');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Залишки за товаром і складом'}).waitFor();
  if(await page.getByLabel('Пошук товарів у залишках').inputValue()!=='TEST-101')throw new Error('Filters not restored');
  await page.getByRole('button',{name:'Історія рухів',exact:true}).first().click();await page.getByRole('heading',{name:/Рух товару/}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Адміністрування',exact:true}).click();await page.getByRole('heading',{name:'Початковий фінансовий баланс'}).waitFor();await page.getByRole('button',{name:'Виконати звірку'}).click();await page.getByText('Кількість і резерви відповідають журналу',{exact:true}).waitFor();
  require('node:fs').mkdirSync('test-results/stock-ledger',{recursive:true});
  await page.screenshot({path:'test-results/stock-ledger/operations-desktop.png',fullPage:true});
  await page.setViewportSize({width:393,height:852});
  for(const tab of ['Довідники','Залишки','Звіти на дату','Адміністрування']){
   await page.getByRole('button',{name:tab,exact:true}).click();await page.waitForTimeout(700);
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile overflow: '+tab);
  }
  await page.screenshot({path:'test-results/stock-ledger/operations-mobile.png',fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('Directory edit, stock history, reconciliation and four mobile panels passed');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
