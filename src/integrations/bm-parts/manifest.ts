import type { ConnectorManifest } from '@/features/integrations/Lib/types'

export const manifest: ConnectorManifest = {
  id: 'bm-parts',
  name: 'Бус Маркет S',
  category: 'accounting',
  countries: ['UA'],
  logo: '/images/integrations/bm-parts.svg',
  docs: '/docs/integrations',
  auth: {
    type: 'api-key',
    fields: [{ key: 'apiKey', label: 'apiKey', type: 'password', required: true }],
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
