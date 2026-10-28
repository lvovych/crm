#!/usr/bin/env python3
"""Prepare customer/vehicle linked Carbook orders without modifying the database.
Payment reconciliation requires an explicit policy; source files remain private.
"""
import argparse, hashlib, importlib.util, json, os
from decimal import Decimal as D
from pathlib import Path

os.umask(0o077)
p = Path(__file__).resolve().parents[1] / '.secrets/carbook'
def number(v): return D(str(v or 0))
def identifier(kind, source):
    return 'cb_' + kind + '_' + hashlib.sha256(f'{org}:{account}:{source}'.encode()).hexdigest()[:32]
def value(v): return float(v)
def quote(v): return "'" + str(v).replace("'", "''") + "'"

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--payments',choices=['source-balance','cash-only'],required=True)
parser.add_argument('--restore-deleted-customer',action='store_true')
a=parser.parse_args()
org=json.loads((p/'import-manifest.json').read_text())['organizationId']
clients={c['clientId']:c for c in json.loads((p/'clients-with-vehicle-owners.json').read_text())}
account=next(iter({c['accountId'] for c in clients.values()}))
spec=importlib.util.spec_from_file_location('ci',Path(__file__).with_name('carbook-import.py'))
ci=importlib.util.module_from_spec(spec);spec.loader.exec_module(ci)
restored=[]
for c in json.loads((p/'absent-previous-clients.json').read_text()):
    if a.restore_deleted_customer:
        clients[c['clientId']]=c;restored.append(ci.customer(c,org))
raw=(p/'orders-with-details.json').read_bytes()
ds=json.loads(raw)
heads={r['id']:r for r in json.loads((p/'orders.json').read_text())}
vehicles={v['clientVehicleId']:v for v in json.loads((p/'vehicles.json').read_text())}
records=[];parts=[];labors=[];payments=[];reconciliations=[]
for d in ds:
    o=d['order'];oid=o['id'];h=heads[oid];rid=identifier('order',oid)
    assert o['status']=='success' and o['businessRequisiteId']==2465
    assert o['num']==h['num'] and o['clientVehicleId']==h['vehicleId'] and o['clientId']==h['clientId']
    cid=o['clientId'];vid=o['clientVehicleId']
    if cid is not None and cid not in clients:
        raise ValueError(f'Historical customer {cid} requires a resolution before generating import')
    assert vid is None or vid in vehicles
    customer_id=ci.customer(clients[cid],org)['id'] if cid is not None else None
    vehicle_id=('carbook_vehicle_'+hashlib.sha256(f'{org}:{account}:{vid}'.encode()).hexdigest()[:32]) if vid else None
    total=number(o['totalSumWithTax']);paid=number(o['paidSum']);debt=number(o['remainingSumWithTax'])
    assert abs(total-paid-debt)<D('.005') and number(o['tax'])==0
    note=f"Імпорт із Carbook. ID: {oid}. Оригінальний номер: {o['num']}.\nКлієнт Carbook: {cid}. Автомобіль Carbook: {vid}."
    for field in ['comment','recommendation','businessComment','systemComment','agreementComment']:
        if o.get(field):note+='\n'+field+': '+str(o[field])
    line_sum=D(0)
    for i,r in enumerate(d['orderDetails']):
        qty=number(r['count']);amount=number(r['sum']);line_sum+=amount
        price=amount/qty if qty else D(0)
        parts.append({'id':identifier('part',f'{oid}:{r["id"]}:{i}'),'serviceRecordId':rid,
            'name':r.get('detailName') or r.get('productname') or 'Запчастина Carbook',
            'partNumber':r.get('detailCode') or r.get('productCode'),'quantity':value(qty),
            'unit':r.get('measureUnit'),'unitPrice':value(price),'total':value(amount),
            'unitCost':value(number(r.get('purchasePrice'))),'markupPercent':0})
    for i,r in enumerate(d['orderServices']):
        qty=number(r.get('count'));amount=number(r['sum']);line_sum+=amount
        labors.append({'id':identifier('labor',f'{oid}:{r["id"]}:{i}'),'serviceRecordId':rid,
            'description':r.get('serviceName') or r.get('defaultName') or 'Робота Carbook',
            'hours':value(qty),'rate':value(amount/qty if qty else D(0)),
            'total':value(amount),'pricingType':'service'})
    # Preserve source line amounts and its independently rounded document total.
    difference=total-line_sum
    discount=max(-difference,D(0))
    if difference>0:
        labors.append({'id':identifier('rounding',oid),'serviceRecordId':rid,
            'description':'Узгодження підсумку з Carbook (округлення / коригування джерела)',
            'hours':1,'rate':value(difference),'total':value(difference),'pricingType':'service'})
    if difference:
        note+=f'\nУзгодження суми документа Carbook з позиціями: {difference} грн.'
    cash=D(0)
    seen=set()
    for c in d['cashOrders']:
        assert c['orderId']==oid and c['clientId']==cid and c['id'] not in seen
        seen.add(c['id']);amount=number(c.get('increase'))-number(c.get('decrease'));cash+=amount
        payments.append({'id':identifier('payment',f'{oid}:{c["id"]}'),'serviceRecordId':rid,
            'amount':value(amount),'date':c['datetime'],'method':'other','provider':'carbook',
            'externalId':str(c['id']),
            'note':f"Касова операція Carbook #{c['id']}; {c['type']}; каса #{c['cashBoxId']}. "+str(c.get('description') or ''),
            'createdAt':c.get('createdAt') or c['datetime'],'updatedAt':c.get('updatedAt') or c['datetime']})
    delta=paid-cash
    if abs(delta)>D('.005'):
        reconciliations.append({'number':o['num'],'cash':value(cash),'sourcePaid':value(paid),'difference':value(delta)})
        note+=f'\nCarbook: сплачено {paid}, сума касових операцій {cash}, розбіжність {delta} грн.'
        if a.payments=='source-balance':
            payments.append({'id':identifier('reconciliation',oid),'serviceRecordId':rid,
                'amount':value(delta),'date':o['successDatetime'] or o['datetime'],'method':'other',
                'provider':'carbook-reconciliation','externalId':str(oid),
                'note':f'Коригування імпорту для збереження балансу Carbook: {delta} грн. Не є окремою касовою операцією.',
                'createdAt':o['datetime'],'updatedAt':o['successDatetime'] or o['datetime']})
    target_paid=paid if a.payments=='source-balance' else cash
    records.append({'id':rid,'title':o['num'],'invoiceNumber':o['num'],'description':note,
        'type':'maintenance','status':'completed','vehicleId':vehicle_id,'customerId':customer_id,
        'organizationId':org,'cost':value(total),'totalAmount':value(total),'subtotal':value(total+discount),
        'taxAmount':0,'taxRate':0,'taxInclusive':False,'discountType':'fixed' if discount else 'none',
        'discountValue':value(discount),'discountAmount':value(discount),'manuallyPaid':False,
        'serviceDate':o['successDatetime'] or o['beginDatetime'],'startDateTime':o['beginDatetime'],
        'endDateTime':o['successDatetime'],'promisedAt':o.get('deliveryDatetime'),
        'invoiceDate':o['datetime'],'mileage':o.get('odometerValue'),'createdAt':o['datetime'],
        'updatedAt':o['successDatetime'] or o['datetime'],
        'techName':' '.join(filter(None,[h.get('employeeName'),h.get('employeeSurname')])),
        'expectedPaid':value(target_paid),'expectedDebt':value(total-target_paid)})
assert len(records)==1066 and len({r['invoiceNumber'] for r in records})==1066
payload={'records':records,'parts':parts,'labors':labors,'payments':payments,'restoredCustomers':restored}
f=p/'orders-import-payload.json';f.write_text(json.dumps(payload,ensure_ascii=False));f.chmod(0o600)
summary={'records':len(records),'sourceParts':sum(len(d['orderDetails']) for d in ds),
    'sourceLabors':sum(len(d['orderServices']) for d in ds),'sourceCashOperations':sum(len(d['cashOrders']) for d in ds),
    'payments':len(payments),'paymentPolicy':a.payments,'reconciliations':len(reconciliations),
    'total':str(sum(number(r['totalAmount']) for r in records)),
    'paid':str(sum(number(r['expectedPaid']) for r in records)),
    'netDebt':str(sum(number(r['expectedDebt']) for r in records)),
    'positiveDebt':str(sum(max(number(r['expectedDebt']),D(0)) for r in records)),
    'credit':str(sum(min(number(r['expectedDebt']),D(0)) for r in records)),
    'sourceSha256':hashlib.sha256(raw).hexdigest()}
(p/'orders-import-summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary))
