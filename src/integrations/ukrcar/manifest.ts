import type { ConnectorManifest } from '@/features/integrations/Lib/types'

export const manifest: ConnectorManifest = {
  id: 'ukrcar',
  name: 'Укркар',
  category: 'accounting',
  countries: ['UA'],
  logo: '/images/integrations/ukrcar.svg',
  docs: '/docs/integrations',
  auth: {
    type: 'api-key',
    fields: [
      { key: 'username', label: 'username', type: 'text', required: true },
      { key: 'password', label: 'password', type: 'password', required: true },
    ],
  },
  capabilities: ['supplier.receipts'],
  settings: [
    {
      key: 'supplierId',
      type: 'remote-select',
      source: 'suppliers',
      label: 'supplier',
      help: 'supplierHelp',
      required: true,
    },
  ],
}
