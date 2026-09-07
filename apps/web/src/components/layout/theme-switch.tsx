import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { applyTheme, detectTheme, storeTheme, type Theme } from '@/lib/theme'

/**
 * Переключатель темы.
 *
 * Класс на `<html>` уже стоит — его выставил скрипт в `index.html`. Здесь только
 * состояние кнопки и реакция на нажатие, чтобы не перерисовывать тему дважды.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useI18n()
  const [theme, setTheme] = useState<Theme>(() => detectTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    storeTheme(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={toggle}
      aria-label={theme === 'dark' ? t.nav.themeLight : t.nav.themeDark}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
