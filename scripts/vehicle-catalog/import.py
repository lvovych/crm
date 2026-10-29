"""Generate the offline ODbL vehicle catalogue from the pinned upstream snapshot.
Usage: python3 scripts/vehicle-catalog/import.py /path/to/all.json
"""
import hashlib
import json
from pathlib import Path
import sys
import unicodedata
import re

SOURCE_SHA = 'ee99776470a45214bf524cdfe22e5dbf4bd67f93'
root = Path(__file__).resolve().parents[2] / 'public/vehicle-catalog'
root.mkdir(parents=True, exist_ok=True)
source = Path(sys.argv[1])
groups = json.loads(source.read_text())
index = []
for group in groups:
    for make in group['makes']:
        name = make['name']
        slug = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()).strip('-')
        assert not any(item['id'] == slug for item in index), slug
        models = []
        for model in make['models']:
            generations = []
            for gen in model.get('generations', []):
                engines = []
                for engine in gen.get('engines', []):
                    label = engine.get('label')
                    if label and not any(e['name'] == label for e in engines):
                        engines.append({'name': label, 'displacementCc': engine.get('displacementCc')})
                existing = next((g for g in generations if g['name'] == gen['name']), None)
                if existing:
                    existing['engines'].extend(e for e in engines if not any(x['name'] == e['name'] for x in existing['engines']))
                else:
                    generations.append({'name': gen['name'], 'from': gen.get('yearStart'), 'to': gen.get('yearEnd'), 'engines': engines})
            models.append({'name': model['name'], 'generations': generations})
        models.sort(key=lambda m: m['name'].casefold())
        (root / f'{slug}.json').write_text(json.dumps({'name': name, 'models': models}, ensure_ascii=False, separators=(',', ':'))+'\n')
        index.append({'id': slug, 'name': name})
index.sort(key=lambda x: x['name'].casefold())
(root / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':'))+'\n')
(root / 'provenance.json').write_text(json.dumps({'repository':'https://github.com/gor3a/vehicle-makes-models','commit':SOURCE_SHA,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'license':'ODbL-1.0','makes':len(index),'transformation':'Only names, generation years, engine labels and displacement retained. Sorted and duplicate engine labels removed.'}, indent=2)+'\n')
print(f'Generated {len(index)} makes')
