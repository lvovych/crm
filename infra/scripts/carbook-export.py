#!/usr/bin/env python3
"""Export all Carbook clients. Keep token and output in an ignored private directory."""
import argparse
import hashlib
import json
import os
import time
import urllib.request
from pathlib import Path


def export(directory):
    os.umask(0o077)
    directory.mkdir(parents=True, exist_ok=True)
    token = (directory / 'token').read_text().strip()
    clients = []
    expected = None
    page = 1
    while True:
        url = ('https://api.carbook.pro/clients?sort%5Bpage%5D=' + str(page)
               + '&sort%5BpageSize%5D=50&options%5BclientDebt%5D=true'
               + '&options%5BlimitVehicles%5D=true&options%5BomitStats%5D=true')
        request = urllib.request.Request(url, headers={
            'authorization': token, 'accept': 'application/json',
            'origin': 'https://my.carbook.pro', 'referer': 'https://my.carbook.pro/',
        })
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    raw = response.read()
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        data = json.loads(raw)
        count = data['stats']['countClients']
        if expected is None:
            expected = count
        if count != expected:
            raise RuntimeError('Client count changed during export; retry a fresh export')
        rows = data['clients']
        (directory / f'page-{page:03}.json').write_bytes(raw)
        clients.extend(rows)
        print(f'Page {page}: {len(rows)} clients', flush=True)
        if len(rows) < 50:
            break
        page += 1
        if page > 1000:
            raise RuntimeError('Pagination did not terminate')
        time.sleep(0.15)
    keys = [(c['accountId'], c['clientId']) for c in clients]
    if len(clients) != expected or len(set(keys)) != expected:
        raise RuntimeError('Missing or duplicate source clients; refusing partial export')
    raw = json.dumps(clients, ensure_ascii=False, indent=2).encode()
    (directory / 'clients.json').write_bytes(raw)
    manifest = {'count': len(clients), 'pages': page,
                'sha256': hashlib.sha256(raw).hexdigest()}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    export(parser.parse_args().directory)
