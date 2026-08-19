import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAppLocale, subscribeAppLocale, type AppLocale } from './appLocale';

const LocaleContext = createContext<AppLocale>(getAppLocale());

export function LocaleProvider({ children }: { readonly children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(getAppLocale);
  useEffect(() => subscribeAppLocale(setLocale), []);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useAppLocale(): AppLocale {
  return useContext(LocaleContext);
}
