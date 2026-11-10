'use client'
import { useState } from 'react'

type Props = {
  accounts: { id: string; name: string }[]
  roles: { id: string; name: string }[]
  access: { accountId: string; roleId: string; canRead: boolean; canPost: boolean }[]
}
export function AccountAccessForm({ accounts, roles, access }: Props) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')
  const current = access.find((a) => a.accountId === accountId && a.roleId === roleId)
  const cls = 'mt-1 min-h-11 w-full rounded-md border bg-background px-3'
  return (
    <>
      <label className="block">
        Рахунок
        <select
          required
          name="accountId"
          className={cls}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Роль
        <select
          required
          name="roleId"
          className={cls}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <div key={`${accountId}:${roleId}`} className="space-y-3 rounded-lg border p-3">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="canRead" defaultChecked={current?.canRead ?? false} />
          Перегляд залишків і рухів
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="canPost" defaultChecked={current?.canPost ?? false} />
          Проведення операцій
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        Показано збережені права для цієї каси. Додатково роль повинна мати відповідні права в
        налаштуваннях ролей.
      </p>
    </>
  )
}
