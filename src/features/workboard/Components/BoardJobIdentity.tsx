/** Shared compact identity for work orders in every board view. */
export function BoardJobIdentity({
  job,
}: {
  job: {
    vehicle?: {
      licensePlate: string | null
      make: string
      model: string
      customer?: { name: string } | null
    } | null
    customerName?: string | null
    customer?: { name: string } | null
  }
}) {
  const customer = job.customerName || job.customer?.name || job.vehicle?.customer?.name
  const lines = [
    job.vehicle?.licensePlate,
    job.vehicle ? `${job.vehicle.make} ${job.vehicle.model}` : null,
    customer,
  ].filter(Boolean)
  return (
    <div className="min-w-0" title={lines.join(' · ')} data-testid="board-job-identity">
      {job.vehicle?.licensePlate && (
        <div className="truncate font-semibold">{job.vehicle.licensePlate}</div>
      )}
      {job.vehicle && (
        <div className="truncate">
          {job.vehicle.make} {job.vehicle.model}
        </div>
      )}
      {customer && <div className="truncate opacity-90">{customer}</div>}
    </div>
  )
}
