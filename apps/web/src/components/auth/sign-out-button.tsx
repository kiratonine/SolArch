import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { logout, queryKeys } from '@/lib/api'
import { useI18n } from '@/lib/i18n'

/**
 * Выход из сессии — с подтверждением.
 *
 * Кнопка стоит в шапке рядом со ссылками, и промах по ней выбрасывал автора из
 * кабинета мгновенно. Само по себе это не потеря данных, но возвращаться придётся
 * через кошелёк и подпись — то есть цена случайного нажатия куда выше, чем у любой
 * другой кнопки в шапке. Поэтому спрашиваем.
 *
 * Диалог отпускает по клику мимо и по Escape: он задаёт вопрос, а не запирает.
 * Любой выход из него, кроме нажатия «Выйти», означает «нет», и требовать за это
 * отдельного нажатия не за что.
 *
 * Обе кнопки названы теми же словами, что и действие («Выйти» / «Остаться»):
 * «Да» и «Нет» вынуждают перечитывать вопрос.
 */
export function SignOutButton({ className }: { className?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      setOpen(false)
      // Сессия обнуляется вручную, а не инвалидацией: повторный запрос `/me`
      // ответил бы 401, и человек увидел бы вспышку ошибки на ровном месте.
      queryClient.setQueryData(queryKeys.session, null)
      queryClient.removeQueries({ queryKey: queryKeys.archives.all })
      await navigate({ to: '/' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={className}>{t.auth.session.signOut}</DialogTrigger>

      <DialogContent>
        <DialogTitle>{t.auth.session.confirm.title}</DialogTitle>
        <DialogDescription>{t.auth.session.confirm.body}</DialogDescription>

        <DialogFooter>
          {/* Отмена стоит первой и набрана как обычная кнопка: она безопасна,
              и именно её человек ищет, если нажал случайно. */}
          <DialogClose
            render={<Button variant="outline" size="sm" />}
            disabled={signOut.isPending}
          >
            {t.auth.session.confirm.cancel}
          </DialogClose>

          <Button
            size="sm"
            variant="destructive"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            {t.auth.session.signOut}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
