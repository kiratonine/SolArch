# PART 06 — Fix Design / Full-Size Desktop Viewer

**Статус:** COMPLETE  
**Дата проверки:** 2026-09-17  
**Ветка:** `integrate/marketplace-backend`

## Результат

Unlocked Viewer переделан в полноразмерное защищённое рабочее пространство. Ограничение `1120px`, внешние вертикальные поля и глобальный scroll в unlocked состоянии убраны. Файловый navigator занимает 264 CSS px, а renderer получает всю оставшуюся ширину и высоту. Archive status, verified signature, RU/EN, watermark и no-export boundary сохранены.

PDF теперь открывается в существующем режиме Fit width и пересчитывает безопасный canvas через `ResizeObserver` при изменении stage. Fit page и ручной zoom сохранены; пределы canvas, 256 KiB ranges и renderer cleanup не менялись.

Follow-up после independent review исправил переход из Fit width/Fit page в manual zoom. Раньше первое нажатие `+`/`−` считалось от скрытого `zoom=1`, а не от фактически отрисованного auto-fit scale, поэтому `+` мог визуально уменьшить страницу. Теперь manual zoom начинается от последнего bounded rendered scale; повторный выбор уже активного fit-mode является безопасным no-op.

Белая Windows title bar заменена на тёмную custom title bar. Главное окно использует `decorations:false`; доступны отдельные minimize, maximize/restore и close buttons. Drag использует штатный `data-tauri-drag-region` Tauri 2.11.5. Capability расширена только четырьмя оконными permissions.

Второй follow-up после live UI review сделал shell viewport-bounded во всех состояниях. `WindowTitleBar` и `AppChrome` больше не участвуют в document scroll; Idle, Locked, Payment и Error прокручиваются только внутри focusable `main.workspace`, а Unlocked сохраняет отдельные локальные scroll-контейнеры файлов и renderer. Это устраняет исчезновение обеих верхних панелей на низком окне, не возвращая глобальный scroll или внешние поля в protected workspace.

Финальный payment/locked follow-up уплотнил transaction workspace: уменьшены outer/header gaps, удалена дублирующая verified-подпись под заголовком, снят искусственный `min-height`, увеличены metadata/payment fonts, а amount/network/status собраны в одну компактную строку. QR использует меньший типовой размер и увеличивается только на высоком desktop viewport; helper и expiry объединены в одну секцию. На типовом Windows окне и maximized Payment/Locked теперь помещаются без вертикальной прокрутки; на маленьком окне остаётся только необходимый local workspace scroll.

Все USDC price/amount значения в Viewer presentation унифицированы до двух знаков после точки: например, signed/API `1.000000` отображается как `1.00`. Decimal-safe formatter не меняет IPC value, Backend payload, storage или payment semantics.

Статус `COMPLETE`: обязательные regression checks и актуальная Windows NSIS сборка прошли; ручная Windows visual/interaction проверка Locked → Payment → Expired → Back → Locked, RU/EN, QR/expiry accessibility и системных оконных controls завершена успешно. Нативные автоматизируемые проверки дополнительно пройдены при 125% DPI. Отдельные 100%/150% display-scale режимы на доступной машине отсутствуют и не заявлены как проверенные.

## Причина исходной проблемы

- `.workspace` ограничивал UI до 1120px и добавлял по 40px сверху/снизу.
- `ArchiveFrame`, `.files-workspace`, `.protected-layout` и `.viewer-surface` не образовывали непрерывную `min-height:0` grid chain.
- Узкая таблица файлов имела фиксированные колонки и горизонтальный overflow.
- PDF вычислял размер только при page/fit/zoom state changes и по умолчанию использовал Fit page.
- Декорированное Tauri window оставляло системную белую Windows title bar.
- Обычный `.app-shell` использовал только `min-height:100vh`, а `.workspace` не был bounded scroll container. Поэтому длинные Locked/Payment/Error surfaces увеличивали весь document и уносили обе верхние панели при вертикальной прокрутке; фиксированный grid shell ранее фактически обеспечивался только unlocked-specific layout.
- Locked/Payment наследовали `40px` vertical workspace padding, header содержал два одинаковых verification сообщения, body принудительно держал `min-height:340px`, а QR/facts/helper/expiry складывались почти полностью вертикально. На 1366×768 при 125% это давало лишние пустоты слева и `35px` ненужного Payment scroll справа.
- Signed Public Header хранит цену с шестью знаками, и UI выводил raw `priceAmount`; Payment DTO мог иметь другую строковую точность. Из-за отсутствия единого presentation formatter Locked button, price и Payment amount выглядели несогласованно.

## Изменённые файлы

- `apps/viewer/src/App.tsx` — один custom title bar, `data-viewer-state`, focusable keyboard-scroll boundary и compact transaction-workspace marker для Locked/Payment/Expired.
- `apps/viewer/src/components/AppChrome.tsx` — компактная application chrome без второго brand block.
- `apps/viewer/src/components/WindowTitleBar.tsx` — новый узкий Tauri window component.
- `apps/viewer/src/components/WindowTitleBar.test.tsx` — window actions, drag-region, RU/EN и rejected-promise regressions.
- `apps/viewer/src/features/archive/ArchiveWorkspace.tsx` — компактный вариант ArchiveFrame для unlocked, плотный Locked layout, presentation-formatted price и согласованный Expired warning style.
- `apps/viewer/src/features/payment/PaymentPanel.tsx` — компактный QR/payment panel, трёхколоночные amount/network/status, читаемые helper/expiry и formatted amount.
- `apps/viewer/src/features/payment/PaymentWorkspace.tsx` — отдельный responsive payment layout modifier.
- `apps/viewer/src/features/payment/formatPaymentAmount.ts` — decimal-safe two-decimal presentation formatter без изменения payment data.
- `apps/viewer/src/features/files/UnlockedWorkspace.tsx` — устойчивый `selectedFileId` и полноразмерный two-pane shell.
- `apps/viewer/src/features/files/FileTable.tsx` — table заменена на семантический button list с selected state, MIME, размером, ellipsis, `title` и `aria-label`.
- `apps/viewer/src/features/files/FileTable.test.tsx` — 4 файла, long name, selected/click/focus, type/size и no-export regressions.
- `apps/viewer/src/features/viewers/PdfViewer.tsx` — default Fit width, `ResizeObserver` с cleanup и manual zoom относительно фактического auto-fit scale.
- `apps/viewer/src/features/viewers/ProtectedViewer.test.tsx` — resize/fit/canvas cleanup и первый Zoom in/out после Fit width/Fit page при сохранённых bounds.
- `apps/viewer/src/i18n.tsx` — RU/EN labels оконных controls и count файлов.
- `apps/viewer/src/styles.css` — viewport-bounded shell, плотные Locked/Payment/Expired layouts, увеличенная metadata/payment typography, adaptive QR, local workspace/pane scroll, full-height unlocked grid, compact file list и dark title bar.
- `apps/viewer/src/App.test.tsx` — two-decimal price, compact readable Payment composition, bounded Idle/Locked/Payment/Error/Unlocked layout, fixed chrome при Payment scroll, expiry → Back и existing flow regressions.
- `apps/viewer/src-tauri/tauri.conf.json` — `decorations:false`, остальные window/bundle параметры сохранены.
- `apps/viewer/src-tauri/capabilities/default.json` — только `allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-start-dragging`.
- `docs/archive-core-viewer/reports/PART_06_FIX_DESIGN_REPORT.md` — этот отчёт.

Backend, `.slr`, API, payment/license/crypto contracts и frozen TTL не менялись. Новых runtime dependencies и plugins нет.

## Автоматические проверки

| Проверка | Результат |
| --- | --- |
| `rtk pnpm --filter @solarch/viewer lint` | PASS |
| `rtk pnpm --filter @solarch/viewer test` | PASS — 5 files, 54 tests |
| `rtk pnpm --filter @solarch/viewer build` | PASS — 1878 modules |
| `rtk cargo fmt --check` | PASS |
| `rtk cargo clippy --workspace --all-targets --all-features -- -D warnings` | PASS — no issues |
| `rtk cargo test --workspace` | PASS — 129 tests, 7 suites |
| native `cargo.exe check --manifest-path apps/viewer/src-tauri/Cargo.toml --all-features` | PASS |
| `node --test scripts/viewer-live-devnet-e2e.test.mjs` | PASS — 5 tests |
| `node --test scripts/create-clean-archive.test.mjs` | PASS — 12 tests |
| `rtk git diff --check` | PASS |

Frontend regressions отдельно подтверждают:

- normal shell для Locked и full-size modifier только для Unlocked;
- fixed viewport shell во всех состояниях: Idle/Locked/Payment/Error имеют только local workspace scroll, Unlocked — только local file/renderer scroll; Payment scroll не меняет координаты WindowTitleBar/AppChrome;
- presentation-only USDC formatter: `1.000000 → 1.00`, integer padding, one-decimal padding и decimal-safe rounding; Locked price/button и Payment amount показывают один формат без raw six-decimal text;
- compact Payment DOM/CSS contract: `12px` transaction workspace padding, zero artificial body min-height, 14px metadata values, 13px helper copy и responsive QR frame;
- четыре file-list entries, полные accessible names и отсутствие export actions;
- точные `minimize` / `toggleMaximize` / `close` calls и isolated drag region;
- PDF default Fit width, Fit page, первый Zoom in/out относительно каждого auto-fit scale, повторный render после stage resize, bounded canvas и observer cleanup;
- watermark/no-export и существующие race-safe renderer tests.

## Windows-native smoke

Сборка: native Windows release, `desktop-runtime,custom-protocol,live-devnet`, frontend предварительно собран в WSL с `SOLARCH_LIVE_FRONTEND_PREBUILT=1`. `viewer:devnet:preflight` прошёл перед NSIS build. Для follow-up expiry smoke создан один новый **неоплаченный** PaymentIntent; повторной USDC-покупки и blockchain transaction не было.

Проверено на Windows/WebView2 при DPI 120 (125%):

- canonical cached Device A `.slr` открылся через association сразу в `unlocked`;
- document viewport `1080×720`, document scroll height `720`: глобального scroll нет;
- final maximized viewport `1536×834`, PDF Fit width canvas `1175×1520`;
- при resize до viewport `866×570` PDF автоматически пересчитан до `521×675`, без blank canvas;
- Fit page дал `212×275`, возврат Fit width — `718×929` в windowed layout;
- отдельный development-fixture `.slr` с настоящим плотным Chrome-generated PDF (`134,191` bytes, 24 отрисованные страницы) прошёл реальный Archive Core → protected renderer path: Fit width `719 → 867` для первого `+` и `719 → 570` для первого `−`; Fit page `273 → 422` и `273 → 148`; resize окна `1366 → 900` пересчитал Fit width canvas `718 → 609`, page осталась `1 of 24`, watermark сохранился; screenshot просмотрен визуально — плотный текст читаем, не размыт CSS transform;
- PDF, PNG, DOCX и XLSX открылись внутренними renderer; watermark присутствовал во всех четырёх;
- production DOM не содержал Save/Export/Print/Open External actions;
- RU → EN переключение дало `lang=en`, active `EN` и persisted locale `en`;
- на свежем production profile актуальный NSIS открыл canonical `.slr` в Locked, ручной Unlock создал ровно один неоплаченный intent и показал реальный QR; Viewer оставался `payment_pending` на всём frozen окне `1800s`, после authoritative Backend expiry автоматически перешёл в `payment_expired`, убрал QR и показал `Вернуться к оплате` / `Закрыть архив`;
- `Вернуться к оплате` вернул тот же verified archive в Locked с сохранёнными title/metadata и доступной Unlock button; после дополнительного ожидания число PaymentIntent в live DB осталось `17 → 17`, то есть новый intent не создавался автоматически; blockchain transaction/issuance для smoke intent отсутствовала;
- исходный Device A secure/app state после smoke восстановлен из проверенного snapshot, credential неоплаченного intent удалён, cached reopen снова дал `unlocked` и 4 protected files;
- archive close уничтожил protected view и вернул Idle; повторный Explorer open того же `.slr` открыл один существующий instance с 4 файлами;
- maximize/restore через реальные custom window buttons прошли нативно (`SHOW_CMD 3 → 1`); close завершил process;
- minimize через real button убрал рабочее окно; последующая ручная Windows проверка также подтвердила restore через taskbar;
- windowed 1366×768 и configured minimum 375×560 outer size сохранили локальный layout и отсутствие body scroll;
- до density follow-up при outer `375×560` (WebView viewport `286×442`) Locked имел workspace `299/839` CSS px, а Payment — `299/1148`; body во всех случаях оставался ровно `442/442`, `WindowTitleBar top=0`, `AppChrome top=40`;
- в низком Payment PageDown, настоящее WebView2 wheel input и mouse scrollbar drag меняли только `workspace.scrollTop` (`0 → 262 → 622`, drag до `503`): QR стал видимым на `top=91..291`, expiry — на `top=340..371`, обе верхние панели оставались на `0/40`;
- Locked и transient live Error на том же размере сохраняли доступные primary/secondary actions и fixed chrome; RU → EN во время прокрутки сохранил QR/state и только ожидаемо пересчитал высоту локального content;
- до density follow-up при outer `1366×768` (viewport `1079×608`) Payment workspace был `471/676`; это измерение стало baseline для устранения лишнего типового scroll, финальный результат приведён ниже;
- custom minimize button дал native `SHOW_CMD=2`, restore вернул `SHOW_CMD=1`, maximize — `SHOW_CMD=3`; native mouse drag переместил окно с `(255,171)` на `(305,211)` без потери state;
- после изолированного scroll-smoke исходный Device A secure/app profile восстановлен: temporary intent credential и snapshot credentials удалены, cached reopen снова дал `unlocked` и четыре protected files;
- после финальной post-WSL native rebuild новый installer повторно установлен: canonical Device A открылся `unlocked` с четырьмя файлами, body остался `720/720`, chrome — `top=0/40`, три системные кнопки присутствовали; maximize/restore дали native `SHOW_CMD 3 → 1`;
- финальный payment-layout smoke использовал отдельный trusted published archive `1e4598da-8a63-4692-8897-949da12b68f1` с одним PNG и неоплаченным intent; blockchain transaction/USDC payment не выполнялись;
- при outer `1366×768`, DPI 120, Payment теперь имеет workspace `471/471`, archive height `458`, body `608/608`; QR, amount `1.00 USDC`, status, helper и expiry одновременно видимы без scroll;
- maximized viewport `1536×834` имеет workspace `698/698`, adaptive QR `216×216` и archive height `506`, без document/local overflow и бессмысленных внутренних пустот;
- Locked на `1366×768` имеет workspace `471/471`, archive height `389`, читабельные 14px metadata и `1.00 USDC` одновременно в price и CTA;
- на outer `375×560` Payment/Locked сохраняют только необходимый local workspace scroll, body остаётся `442/442`, а title bars — `top=0/40`; Expired screen полностью показывает `Back to payment` и `Close archive`;
- natural Backend expiry автоматически дал `payment_expired`; `Back to payment` вернул тот же archive в Locked, сохранил `1.00 USDC` и не создал новый intent автоматически;
- RU/EN переключение сохранило state/layout и two-decimal price; ручная визуальная проверка Windows screenshots и interaction flow прошла успешно;
- 1920×1080 monitor/maximized и 125% scaling проверены; 2560×1440 и отдельные 100%/150% scaling в доступной машине отсутствуют.

## Screenshots

Локальные safe screenshots без credentials/secrets:

- before unlocked: `artifacts/part06/before-unlocked.png`
- before PDF: `artifacts/part06/before-pdf.png`
- final unlocked: `artifacts/part06/after-final-nsis-unlocked.png`
- final maximized PDF: `artifacts/part06/after-final-nsis-pdf.png`
- dense multipage PDF follow-up: `artifacts/part06/dense-pdf-native.png`
- final installer pending/payment QR: `artifacts/part06/payment-pending-final-installer.png`
- final compact Payment 1366×768: `artifacts/part06/payment-polish-final-1366x768.png`
- final compact Payment maximized: `artifacts/part06/payment-polish-final-maximized.png`
- final Expired 375×560: `artifacts/part06/payment-polish-expired-375x560.png`
- final Locked 375×560: `artifacts/part06/locked-polish-final-375x560.png`
- final Locked 1366×768: `artifacts/part06/locked-polish-final-1366x768.png`

## Windows NSIS

- Path: `D:\install\projects\solarch\target\release\bundle\nsis\SolArch Viewer_0.1.0_x64-setup.exe`
- Timestamp: `2026-09-17 17:15:35 +05:00`
- Size: `4,902,402 bytes`
- SHA-256: `1108a03ef66eb8db60bbf6439975f00ab2580718faab70d15989e97753dbf120`

## Security / integration impact

- Protected plaintext по-прежнему остаётся только внутри renderer/session boundary.
- Watermark остаётся поверх protected stage.
- Context-menu/print/save hardening, renderer generations и forced cleanup не менялись.
- File navigator не добавляет export, drag-out или external-open path.
- Custom window capability не включает shell, process, filesystem или broad window permissions.
- Payment, entitlement, license, ACK/HPKE и Backend flows не изменены.
- Clean review archive создан после прохождения archive-safety regression; runtime `artifacts/`, `storage_data/`, `.env`, secrets и build outputs в него не входят.

Design-guideline review повлиял только на presentation: semantic buttons, видимый keyboard focus, локальный scroll и отсутствие лишних nested cards; security/product boundaries остались прежними.
