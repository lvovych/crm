import { readFile, writeFile } from 'node:fs/promises'
import { prepareApprovedSupplierPlan } from '../src/features/suppliers/Lib/approvedPlan'

async function main() {
  const [snapshotPath, approvalPath, organizationId, outputPath] = process.argv.slice(2)
  if (!snapshotPath || !approvalPath || !organizationId || !outputPath)
    throw new Error('Usage: tsx scripts/prepare-supplier-import.ts snapshot.json approval.json organizationId plan.json')
  const plan = prepareApprovedSupplierPlan(
    JSON.parse(await readFile(snapshotPath, 'utf8')),
    JSON.parse(await readFile(approvalPath, 'utf8')),
    organizationId
  )
  // This offline command cannot certify target database conflicts or current links.
  const output = { ...plan, ready: false, targetDatabaseChecked: false,
    blockers: [...plan.blockers, 'Target database conflict and source-link check required before execution'] }
  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ ...output.summary, ready: output.ready, blockers: output.blockers }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
