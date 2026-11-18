import { redirect } from 'next/navigation'

// Keep bookmarks working after removing the duplicate customer invoice register.
export default function BillingPage() {
  redirect('/mutual-settlements')
}
