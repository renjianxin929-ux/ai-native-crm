import { t, tFormat } from '../i18n/appLocale';

export function evidenceEntryLabel(count: number): string {
  return count > 0 ? tFormat('customer.detail.evidenceCount', { n: count }) : t('customer.detail.evidence');
}
