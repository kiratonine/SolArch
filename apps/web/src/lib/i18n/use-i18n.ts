import { use } from 'react'

import { I18nContext, type I18nValue } from './context'

/**
 * Единственная точка доступа к языку.
 *
 * Строки в компонентах не пишем: всё через `t`, иначе одна из локалей молча отстанет.
 */
export function useI18n(): I18nValue {
  const value = use(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used inside <I18nProvider>')
  }
  return value
}
