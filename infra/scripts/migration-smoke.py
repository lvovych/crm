#!/usr/bin/env python3
"""Read-only authenticated smoke checks; never print credentials or cookies."""
import argparse, http.cookiejar, json, socket, urllib.request
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--ip', required=True)
p.add_argument('--credentials', required=True)
p.add_argument('--service-id', required=True)
a=p.parse_args()
host='crm.srv.lauto.com.ua'; base='https://'+host
original=socket.getaddrinfo
socket.getaddrinfo=lambda h,*args,**kwargs: original(a.ip if h==host else h,*args,**kwargs)
client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
creds=json.loads(Path(a.credentials).read_text())
login=urllib.request.Request(base+'/api/public/auth/sign-in/email',data=json.dumps({'email':creds['email'],'password':creds['password']}).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST')
with client.open(login,timeout=45) as r:
 assert r.status==200
print('Authenticated sign-in OK')
for route in ['/api/public/auth/get-session','/customers','/work-orders','/inventory',f'/api/protected/services/{a.service_id}/completion-act-pdf',f'/api/protected/services/{a.service_id}/work-order-pdf']:
 with client.open(base+route,timeout=90) as r:
  body=r.read()
  assert r.status==200 and '/login' not in r.url
  if 'get-session' in route:
   assert json.loads(body)['user']['email']==creds['email']
  if route.endswith('pdf'):
   assert body.startswith(b'%PDF-') and len(body)>1000
  print(route, 'OK',len(body),'bytes')
