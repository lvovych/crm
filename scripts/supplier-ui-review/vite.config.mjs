import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({root:resolve('scripts/supplier-ui-review'),resolve:{alias:[
{find:/.*Actions\/supplierActions$/,replacement:resolve('scripts/supplier-ui-review/actions.js')},
{find:/.*Actions\/importActions$/,replacement:resolve('scripts/supplier-ui-review/actions.js')},
{find:'next/navigation',replacement:resolve('scripts/supplier-ui-review/navigation.js')},
{find:'next/link',replacement:resolve('scripts/supplier-ui-review/link.jsx')},
{find:'next-intl/server',replacement:resolve('scripts/supplier-ui-review/intl.js')},
{find:'@/components/page-header',replacement:resolve('scripts/supplier-ui-review/header.jsx')},
{find:'@',replacement:resolve('src')} ]},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:4175,strictPort:true,fs:{allow:[resolve('.')]}}})
