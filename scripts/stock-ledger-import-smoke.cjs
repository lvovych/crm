const {chromium}=require('@playwright/test');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  const login=await ctx.request.post('http://localhost:3097/api/public/auth/sign-in/email',{timeout:120000,headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Local login failed');
  await page.goto('http://localhost:3097/stock-ledger',{timeout:120000,waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Адміністрування',exact:true}).waitFor();await page.getByRole('button',{name:'Імпорт',exact:true}).click();
  await page.getByLabel('Постачальник імпорту').selectOption({index:1});await page.getByLabel('Склад імпорту').selectOption({index:1});
  const bytes=Buffer.from('Артикул;Бренд;Кількість;Ціна\nUNKNOWN-'+Date.now()+';---;2;12.34');
  await page.getByLabel('Файл',{exact:true}).setInputFiles({name:'manual.csv',mimeType:'text/csv',buffer:bytes});
  await page.getByRole('button',{name:'Попередній перегляд',exact:true}).click();await page.getByRole('button',{name:'Вибрати товар',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Пошук відповідності імпорту').fill('TEST-101');await dialog.getByRole('button',{name:/TEST-101/}).click();await dialog.waitFor({state:'hidden'});
  await page.getByText(/З помилками: 0/).waitFor();
  const original=await page.getByRole('link',{name:'Завантажити оригінал'}).getAttribute('href');const downloaded=await ctx.request.get('http://localhost:3097'+original);if(downloaded.status()!==200||!(await downloaded.body()).equals(bytes))throw new Error('Original download mismatch');
  const anonymous=await browser.newContext();if((await anonymous.request.get('http://localhost:3097'+original)).status()===200)throw new Error('Anonymous original access');await anonymous.close();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByText(/З помилками: 0/).waitFor();await page.getByLabel('Склад імпорту').selectOption({index:1});
  await page.getByLabel('Номер накладної',{exact:true}).fill('IMPORT-UI-'+Date.now());await page.getByRole('button',{name:'Створити чернетку',exact:true}).click();await page.getByText('Чернетку створено. Відкрийте її у «Надходженнях» для перевірки та проведення.',{exact:true}).waitFor();
  await page.setViewportSize({width:393,height:852});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Import mobile overflow');await page.screenshot({path:'test-results/stock-ledger/import-mobile.png',fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));console.log('Docker queued import: original download and auth, resume after reload, manual mapping, draft only, mobile passed');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
