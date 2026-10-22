// Isolated local smoke test. Seed scripts/stock-ledger-test-seed.ts first.
const {chromium}=require('@playwright/test');
(async()=>{
 const suffix=Date.now().toString();
 require('node:fs').mkdirSync('test-results/stock-ledger',{recursive:true});
 const browser=await chromium.launch({headless:true,channel:"chrome"});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});const page=await ctx.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>console.error("PAGE",e.message));
 const login=await ctx.request.post('http://localhost:3097/api/public/auth/sign-in/email',{headers:{Origin:'http://localhost:3097'},data:{email:'ledger-ui@example.test',password:'LocalLedgerTest!2026'}});if(login.status()!==200)throw new Error('Login '+login.status());
 await page.goto('http://localhost:3097/stock-ledger',{timeout:120000,waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Склад і постачальники'}).waitFor();await page.waitForTimeout(4000);
 await page.getByRole('button',{name:'Довідники',exact:true}).click();await page.getByRole('heading',{name:'Створити запис довідника'}).waitFor();await page.screenshot({path:'test-results/stock-ledger/ledger-debug.png'});
 await page.getByLabel('Назва',{exact:true}).fill('Постачальник '+suffix);await page.getByRole('button',{name:'Створити',exact:true}).click();await page.getByText('Створено',{exact:true}).waitFor();await page.screenshot({path:'test-results/stock-ledger/ledger-after-create.png'});
 await page.getByLabel('Тип',{exact:true}).selectOption('warehouse');await page.getByLabel('Назва',{exact:true}).fill('Склад '+suffix);await page.getByLabel('Код складу').fill('W'+suffix);await page.getByRole('button',{name:'Створити',exact:true}).click();await page.waitForTimeout(1000);
 await page.getByRole('button',{name:'Надходження',exact:true}).click();await page.getByRole('button',{name:'Нове надходження',exact:true}).click();await page.getByLabel('Постачальник',{exact:true}).selectOption({label:'Постачальник '+suffix});await page.getByLabel('Склад',{exact:true}).selectOption({label:'Склад '+suffix});await page.getByLabel('Номер накладної постачальника').fill('UI-1');
 await page.getByRole('combobox',{name:'Додати товар'}).fill('TEST-101');await page.locator('#ledger-products [role=option]').first().waitFor();await page.getByRole('combobox',{name:'Додати товар'}).press('Enter');
 await page.getByLabel('Кількість',{exact:true}).fill('10');await page.getByLabel('Закупівельна ціна',{exact:true}).fill('200');await page.getByRole('button',{name:'Зберегти чернетку',exact:true}).click();await page.getByText('Чернетку збережено',{exact:true}).waitFor();
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Провести збережену чернетку',exact:true}).click();await page.getByRole('heading',{name:'Надходження — проведено',exact:true}).waitFor();
 await page.getByText('Сума: 2000.00 грн',{exact:true}).waitFor();await page.screenshot({path:'test-results/stock-ledger/ledger-desktop.png',fullPage:true});await page.setViewportSize({width:393,height:852});await page.screenshot({path:'test-results/stock-ledger/ledger-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)throw new Error('Mobile horizontal overflow');
 console.log('UI keyboard receipt posting and mobile width passed');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
