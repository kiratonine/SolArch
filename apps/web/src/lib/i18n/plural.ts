import type { Locale } from './locale'

/**
 * Плюрализация через `Intl.PluralRules`.
 *
 * Русский требует три формы (файл / файла / файлов), английский — две.
 * Держать эти правила руками не нужно: платформа знает их для любой локали,
 * а словарь просто перечисляет формы, которые она попросит.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

export type PluralFn = (count: number, forms: PluralForms) => string

export function makePlural(locale: Locale): PluralFn {
  const rules = new Intl.PluralRules(locale)
  return (count, forms) => forms[rules.select(count)] ?? forms.other
}
