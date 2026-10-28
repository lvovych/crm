#!/usr/bin/env python3
import json,re,hashlib
from decimal import Decimal as D,ROUND_HALF_UP
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'.secrets/manual-orders'
x=json.loads((p/'extracted.json').read_text());out=[]
for d in x:
 assert len(d['sheets'])==1
 cells={c['cell']:c for row in d['sheets'][0]['rows'] for c in row}
 v={k:c['value'] for k,c in cells.items()};date=re.search(r'від (\d{2}\.\d{2}\.\d{4})',v['A1']).group(1)
 name=phone=None
 for row in d['sheets'][0]['rows']:
  vals={re.sub(r'\d','',c['cell']):c['value'] for c in row}
  if vals.get('E')=='Замовник':name=vals.get('F')
  if vals.get('E')=='Тел.':phone=vals.get('F')
 text=next(str(a) for a in v.values() if str(a).startswith('Транспортний засіб:'))
 vins=re.findall(r'(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])',text.upper())
 plate=re.findall(r'(?<![\w])[A-ZА-ЯІЇЄ]{2}\d{4}[A-ZА-ЯІЇЄ]{2}(?![\w])',text.upper())
 mileage=re.search(r'[;,]\s*([\d ]+)\s*км',text)
 total=next(D(str(v.get('H'+re.search(r'\d+',k).group()))) for k,a in v.items() if str(a).startswith('Загальна сума'))
 items=[];kind=None;errors=[]
 for row in d['sheets'][0]['rows']:
  vals={re.sub(r'\d','',c['cell']):c['value'] for c in row}
  if vals.get('B')=='Назва послуг':kind='labor'
  if vals.get('B')=='Назва запчастин':kind='part'
  if kind and vals.get('B') and vals.get('F') is not None and vals.get('G') is not None and vals.get('H') is not None and vals.get('B') not in ['Назва послуг','Назва запчастин']:
   qty=D(str(vals.get('F') or 0));price=D(str(vals.get('G') or 0).replace(',',''));amount=D(str(vals.get('H') or 0))
   if abs(qty*price-amount)>D('.01'):errors.append({'row':row[0]['cell'],'qtyPrice':str(qty*price),'amount':str(amount)})
   items.append({'kind':kind,'name':str(vals['B']).strip(),'brand':vals.get('C'),'unit':vals.get('E'),'quantity':float(qty),'unitPrice':float(price),'total':float(amount)})
 row={'file':d['file'],'sha256':hashlib.sha256((p/d['file']).read_bytes()).hexdigest(),'date':date,'name':name,'phone':re.sub(r'\D','',str(phone or '')),'vehicleText':text,'vin':vins[0] if len(vins)==1 else None,'plate':plate[0] if plate else None,'mileage':int(mileage.group(1).replace(' ','')) if mileage and mileage.group(1).strip() else None,'total':float(total.quantize(D('.01'),rounding=ROUND_HALF_UP)),'items':items,'errors':errors,'lineDelta':float(sum(D(str(i['total'])) for i in items)-total)}
 out.append(row)
(p/'parsed.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
for r in out:print(r['file'],'total',r['total'],'lines',len(r['items']),'delta',r['lineDelta'],'errors',r['errors'],'vin',r['vin'])
