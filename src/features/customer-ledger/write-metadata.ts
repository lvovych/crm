/** Persist the current author with writes. Background writes explicitly clear old authors. */
export function ledgerWriteMetadata(
  model: string | undefined,
  operation: string,
  args: unknown,
  actor: { userId: string | null; name: string | null }
) {
  if (!['ServiceRecord', 'Payment'].includes(model ?? '')) return args
  const a = args as Record<string, unknown>
  const stamp = (data: unknown): unknown =>
    Array.isArray(data)
      ? data.map(stamp)
      : { ...(data as object), ledgerActorId: actor.userId, ledgerActorName: actor.name }
  if (
    [
      'create',
      'createMany',
      'createManyAndReturn',
      'update',
      'updateMany',
      'updateManyAndReturn',
    ].includes(operation)
  )
    return { ...a, data: stamp(a.data) }
  if (operation === 'upsert') return { ...a, create: stamp(a.create), update: stamp(a.update) }
  return args
}
