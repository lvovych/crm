# Vehicle catalogue

Source: vehicle-makes-models by gor3a, https://github.com/gor3a/vehicle-makes-models
Upstream vehicle data: https://www.autoevolution.com/
Pinned revision: ee99776470a45214bf524cdfe22e5dbf4bd67f93

This adapted database is offered under ODbL 1.0:
https://opendatacommons.org/licenses/odbl/1-0/
See LICENSE.md and provenance.json. The JSON files in this directory are the
complete adapted dataset, served publicly at /vehicle-catalog/; index.json lists
all make files. No licence is imposed on workshop/customer records by this code.

Transformation: retain make/model/generation/engine names, years and displacement;
remove other specs, sort models, deduplicate engine labels. Regenerate using
scripts/vehicle-catalog/import.py with data/json/all.json from the pinned revision.

Coverage is not exhaustive. In particular, regional, historical and commercial
vehicles may be absent. A missing entry must never prevent creating a vehicle.
Colours are independent of this database: the 11 basic registration colours
published by the Ukrainian Ministry of Internal Affairs service centre:
https://hsc.gov.ua/2024/07/19/zminiv-kolir-avto-otrimaj-nove-svidotstvo-pro-reyestratsiyu-transportnogo-zasobu/
