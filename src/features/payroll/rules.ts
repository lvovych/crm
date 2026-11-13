export const ruleLabels = {
  monthly: 'Оклад за місяць', labor: 'Виконані роботи', partsSales: 'Продаж запчастин',
  partsMargin: 'Маржа запчастин', orderMargin: 'Маржа наряду',
}
export type Basis = keyof typeof ruleLabels
type DiscountPlan = { afterDiscount: boolean; marginAfterDiscount: boolean; discountsByBasis?: unknown }
export function includesDiscounts(basis: Basis, plan: DiscountPlan) {
  const overrides = plan.discountsByBasis
  if (typeof overrides === 'object' && overrides && basis in overrides) {
    const value = (overrides as Record<string, unknown>)[basis]
    if (typeof value === 'boolean') return value
  }
  return basis === 'labor' || basis === 'partsSales' ? plan.afterDiscount : plan.marginAfterDiscount
}
export function ruleConditions(basis: Basis, plan: DiscountPlan & { includeNegativeOrderMargin: boolean }) {
  if (basis === 'monthly') {
    const settings = plan.discountsByBasis
    const method = 'Пропорційно календарним дням'
    if (!settings || typeof settings !== 'object' || !('monthly' in settings)) return method
    return method + (settings.monthly ? ' · Враховувати знижки: так' : ' · Враховувати знижки: ні')
  }
  const discounts = includesDiscounts(basis, plan)
    ? 'Після знижок' : 'До знижок'
  if (basis !== 'orderMargin') return discounts
  return discounts + (plan.includeNegativeOrderMargin ? ' · Від’ємна маржа враховується' : ' · При збитку база 0 грн')
}
