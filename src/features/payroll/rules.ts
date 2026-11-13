export const ruleLabels = {
  monthly: 'Оклад за місяць', labor: 'Виконані роботи', partsSales: 'Продаж запчастин',
  partsMargin: 'Маржа запчастин', orderMargin: 'Маржа наряду',
}
export type Basis = keyof typeof ruleLabels
export function ruleConditions(basis: Basis, plan: { afterDiscount: boolean; marginAfterDiscount: boolean; includeNegativeOrderMargin: boolean }) {
  if (basis === 'monthly') return 'Пропорційно календарним дням'
  const discounts = (basis === 'labor' || basis === 'partsSales' ? plan.afterDiscount : plan.marginAfterDiscount)
    ? 'Після знижок' : 'До знижок'
  if (basis !== 'orderMargin') return discounts
  return discounts + (plan.includeNegativeOrderMargin ? ' · Від’ємна маржа враховується' : ' · При збитку база 0 грн')
}
