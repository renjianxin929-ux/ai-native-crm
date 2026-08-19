/**
 * Locale Source of Truth. Display only — never capability/DB/A10/nonce.
 */

import { TRANSLATION_CATALOG, type AppLocale, type TranslationKey } from './catalog';

export type { AppLocale, TranslationKey };

export const APP_LOCALE_SETTING_KEY = 'app_locale';

export interface LocalePersistence {
  read: () => string | null;
  write: (locale: AppLocale) => void;
}

const DEFAULT_LOCALE: AppLocale = 'zh-CN';
const listeners = new Set<(locale: AppLocale) => void>();

let currentLocale: AppLocale = DEFAULT_LOCALE;
let persistence: LocalePersistence = {
  read: () => currentLocale,
  write: () => undefined,
};

function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US';
}

export function getAppLocale(): AppLocale {
  return currentLocale;
}

export function subscribeAppLocale(listener: (locale: AppLocale) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function configureLocalePersistence(adapter: LocalePersistence): void {
  persistence = adapter;
}

export function hydrateAppLocale(): void {
  const stored = persistence.read();
  if (isAppLocale(stored)) {
    currentLocale = stored;
    listeners.forEach(listener => listener(currentLocale));
  }
}

export function resetAppLocaleForTests(): void {
  currentLocale = DEFAULT_LOCALE;
  listeners.forEach(listener => listener(currentLocale));
}

export function setAppLocale(locale: AppLocale, options?: { readonly persist?: boolean }): void {
  if (currentLocale === locale) {
    if (options?.persist !== false) persistence.write(locale);
    return;
  }
  currentLocale = locale;
  if (options?.persist !== false) persistence.write(locale);
  listeners.forEach(listener => listener(currentLocale));
}

/** Never return a raw schema/capability key. Missing copy becomes a generic label. */
export function t(key: string): string {
  const entry = (TRANSLATION_CATALOG as Record<string, Readonly<Record<AppLocale, string>>>)[key];
  if (entry?.[currentLocale]) return entry[currentLocale];
  if (entry?.[DEFAULT_LOCALE]) return entry[DEFAULT_LOCALE];
  return currentLocale === 'en-US' ? 'Other details' : '其他信息';
}

export function tFormat(key: string, vars: Readonly<Record<string, string | number>>): string {
  return Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), t(key));
}

export function tField(fieldKey: string): string {
  const named = t(`field.${fieldKey}`);
  if (named !== 'Other details' && named !== '其他信息') return named;
  if (`field.${fieldKey}` in TRANSLATION_CATALOG) return named;
  return t('common.otherField');
}

export function tEnum(value: string): string | null {
  const key = `enum.${value}`;
  if (key in TRANSLATION_CATALOG) return t(key);
  return null;
}

export function tStage(stage: string): string {
  const key = `stage.${stage}`;
  if (key in TRANSLATION_CATALOG) return t(key);
  return t('common.otherField');
}

export function formatStageLabel(stage: string): string {
  return tStage(stage);
}

export function tGrade(grade: string): string {
  const key = `grade.${grade}`;
  if (key in TRANSLATION_CATALOG) return t(key);
  return grade;
}
