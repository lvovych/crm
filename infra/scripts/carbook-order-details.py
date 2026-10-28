#!/usr/bin/env python3
"""Fetch each order once; resume from private saved files, then freeze one JSON."""
import concurrent.futures,json,urllib.request,time,os
from pathlib import Path
os.umask(0o077)
p=Path(__file__).resolve().parents[1]/'.secrets/carbook'
orders=json.loads((p/'orders.json').read_text())
keys=['order','cashOrders','orderDetails','orderServices','orderRecommendations']
def fetch(o):
 f=p/f"order-detail-{o['id']}.json"
 if f.exists():return {k:v for k,v in json.loads(f.read_text()).items() if k in keys}
 for attempt in range(4):
  try:
   req=urllib.request.Request(f"https://api.carbook.pro/orders/{o['id']}",headers={'authorization':(p/'token').read_text(),'origin':'https://my.carbook.pro'})
   with urllib.request.urlopen(req,timeout=30) as r:x=json.load(r)
   assert x['order']['id']==o['id']
   x={k:v for k,v in x.items() if k in keys};f.write_text(json.dumps(x,ensure_ascii=False));return x
  except Exception:
   if attempt==3:raise
   time.sleep(2**attempt)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 rows=[]
 for i,x in enumerate(pool.map(fetch,orders),1):
  rows.append(x)
  if i%100==0:print('details',i,flush=True)
(p/'orders-with-details.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print('complete',len(rows))
