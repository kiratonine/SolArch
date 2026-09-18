import type { PublicFileEntry } from '@/lib/api'
import { groupFilesByFolder } from '@/lib/files'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Опись содержимого — второй по важности носитель темы после корешка карточки.
 *
 * Контейнер запечатан, но его опись публична: видно, как называются файлы,
 * где они лежат и сколько весят. Открыть их без оплаты нельзя, узнать состав —
 * можно, и именно на этом посетитель решает, забирать ли `.slr`.
 *
 * Пути и имена — машинные строки, поэтому набраны IBM Plex Mono; веса — табличными
 * цифрами, чтобы колонка справа стояла ровно. Разделители те же волосяные линии,
 * что и везде: ни одной тени.
 *
 * Расширение и mime-тип из ответа намеренно не рисуем: имя файла уже кончается
 * расширением, и повторить его сорок раз — это шум, а не сведения.
 */
export function FileManifest({
  files,
  className,
}: {
  files: PublicFileEntry[]
  className?: string
}) {
  const { t, format } = useI18n()
  const groups = groupFilesByFolder(files)

  return (
    <div className={cn('border-border overflow-hidden rounded-lg border', className)}>
      {groups.map((group) => (
        <section key={group.folder} className="border-border border-t first:border-t-0">
          {group.folder !== '' && (
            <h3 className="bg-muted/50 flex items-baseline justify-between gap-4 px-4 py-2 font-mono text-xs font-normal tracking-normal">
              <span className="text-foreground min-w-0 truncate">{group.folder}/</span>
              <span className="numeric text-muted-foreground shrink-0">
                {format.count(group.files.length)} {t.units.files(group.files.length)}
              </span>
            </h3>
          )}

          <ul className={cn(group.folder !== '' && 'border-border border-t')}>
            {group.files.map((file) => (
              <li
                key={file.display_path}
                className={cn(
                  'border-border/70 flex items-baseline justify-between gap-4 border-t py-2 pr-4 first:border-t-0',
                  // Файл внутри папки отбит отступом: без него заголовок папки
                  // встаёт в один ряд со своим содержимым и опись читается плоской.
                  group.folder === '' ? 'pl-4' : 'pl-9',
                )}
              >
                <span className="min-w-0 truncate font-mono text-[0.8125rem]">
                  {file.display_name}
                </span>
                <span className="numeric text-muted-foreground shrink-0 text-xs">
                  {format.bytes(file.size_bytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
