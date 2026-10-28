#!/usr/bin/env python3
"""Prepare one-time imports from extracted acts; never carry source MRD numbers into CRM."""
import json,hashlib,re
from pathlib import Path
from decimal import Decimal as D,ROUND_HALF_UP
from datetime import datetime
p=Path(__file__).resolve().parents[1]/'.secrets/manual-orders'
rows=json.loads((p/'matched.json').read_text());target=json.loads((p/'target.json').read_text())
decisions=json.loads((p/'decisions.json').read_text())
assert decisions['paid'] is True and decisions['useNumericTotals'] is True
org='2265bbef-78ea-4987-8c2d-221cf0f215ef'
def ident(kind,key):return 'manual_'+kind+'_'+hashlib.sha256((org+key).encode()).hexdigest()[:24]
def money(n):return float(D(str(n)).quantize(D('.01'),rounding=ROUND_HALF_UP))
cs={c['id']:c for c in target['customers']};vs={v['id']:v for v in target['vehicles']}
newcs={};newvs={};records=[];parts=[];labors=[];report=[]
car_specs={'AudiA4-MRD-8139-3378674.xlsx':('AUDI','A4 Allroad quattro',2013),'Peugeot.xlsx':('PEUGEOT','5008 (P87E)',2018),'tesla-MRD-8139-3378675.xlsx':('Tesla','Model 3',2024),'beetle.xlsx':('VW','Beetle',decisions['beetleYear'])}
for pos,r in enumerate(rows):
 assert len(r['vehicleMatches'])<=1 and len(r['customerMatches'])<=1
 cid=r['customerMatches'][0] if r['customerMatches'] else None
 if cid is None and r['name'] and r['phone']:
  cid=ident('customer',r['phone']);newcs[cid]={'id':cid,'name':r['name'],'phone':'+'+r['phone']}
 if r['file']=='beetle.xlsx':
  assert decisions.get('beetleCustomerId') is None or decisions['beetleCustomerId'] in cs
  cid=decisions.get('beetleCustomerId')
 if r['vehicleMatches']:vid=r['vehicleMatches'][0]
 else:
  make,model,year=car_specs[r['file']];assert isinstance(year,int) and 1886<=year<=2027
  vid=ident('vehicle',r['vin'] or (str(cid)+make+model+str(year)))
  newvs[vid]={'id':vid,'make':make,'model':model,'year':year,'vin':r['vin'],'licensePlate':r['plate'],'customerId':cid,'mileage':r['mileage'] or 0}
 if r['file']=='beetle.xlsx':newvs[vid]['engineCode']=decisions['beetleEngineCode']
 rid=ident('order',r['sha256']);date=datetime.strptime(r['date'],'%d.%m.%Y').strftime('%Y-%m-%dT09:00:00Z')
 note='Імпорт із наданого акта. Повну оплату підтверджено власником під час імпорту.'
 if r['errors']:note+=' Суми рядків збережено з документа; ціни за одиницю узгоджено з цими сумами.'
 selected=list(r['items']);total=r['total']
 if r['file']=='Crafter-2F-1.xlsx':
  choice=decisions['crafterPolicy'];assert choice in ['discount','full','exclude']
  if choice=='full':total=6145
  if choice=='exclude':selected=[i for i in selected if i['name']!='Регулювання кутів встановлення коліс (розвалу-сходження)']
 subtotal=0
 for n,i in enumerate(selected):
  amount=money(i['total']);qty=i['quantity'];subtotal+=amount;rate=amount/qty if qty else 0
  if i['kind']=='part':
   name=i['name']+(' ('+str(i['brand'])+')' if i.get('brand') and i['brand']!='---' else '')
   parts.append({'id':ident('part',r['sha256']+str(n)),'serviceRecordId':rid,'name':name,'quantity':qty,'unitPrice':rate,'total':amount,'unit':i.get('unit')})
  else:labors.append({'id':ident('labor',r['sha256']+str(n)),'serviceRecordId':rid,'description':i['name'],'hours':qty,'rate':rate,'total':amount,'pricingType':'service'})
 subtotal=money(subtotal);discount=money(subtotal-total);assert discount>=0
 if discount:note+=f' Знижка за підтвердженим підсумком акта: {discount:.2f} грн.'
 veh=vs.get(vid) or newvs[vid]
 records.append({'id':rid,'title':'Обслуговування '+veh['make']+' '+veh['model'],'description':note,'vehicleId':vid,'customerId':cid,'status':'completed','type':'maintenance','serviceDate':date,'invoiceDate':date,'cost':total,'subtotal':subtotal,'totalAmount':total,'discountType':'fixed' if discount else 'none','discountValue':discount,'discountAmount':discount,'manuallyPaid':True,'mileage':r['mileage'],'position':pos})
 report.append({'file':r['file'],'recordId':rid,'total':total,'customerId':cid,'vehicleId':vid,'sourceHash':r['sha256']})
payload={'records':records,'parts':parts,'labors':labors,'customers':list(newcs.values()),'vehicles':list(newvs.values())}
assert 'MRD-' not in json.dumps(payload,ensure_ascii=False)
(p/'payload.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2));(p/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'orders':len(records),'newCustomers':len(newcs),'newVehicles':len(newvs),'parts':len(parts),'labor':len(labors),'total':money(sum(r['totalAmount'] for r in records))}))
