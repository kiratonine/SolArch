/**
 * Работа с суммами USDC.
 *
 * Правила зафиксированы командой:
 *  - API передаёт суммы как decimal string (`docs/API.md` §1.2);
 *  - float как источник истины запрещён;
 *  - расчёт ведётся в целых base units, комиссия платформы считается первой,
 *    автору достаётся остаток (`docs/PAYMENTS.md` §5).
 *
 * Frontend считает только ПРЕВЬЮ до создания архива. После create источником истины
 * является объект `economics` из ответа backend (`docs/INTEGRATION.md` §10).
 */

/** USDC на Solana использует 6 знаков после запятой. */
export const USDC_DECIMALS = 6

/** Комиссия платформы: 5% = 500 базисных пунктов (`docs/DECISIONS.md` ADR-006). */
export const PLATFORM_FEE_BPS = 500

const BPS_DENOMINATOR = 10_000n
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/

export class MoneyFormatError extends Error {
  constructor(value: string, reason: string) {
    super(`Invalid USDC amount "${value}": ${reason}`)
    this.name = 'MoneyFormatError'
  }
}

/**
 * Переводит decimal string в целые base units.
 *
 * @example parseUsdc('10.00') // 10_000_000n
 */
export function parseUsdc(value: string): bigint {
  const trimmed = value.trim()

  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new MoneyFormatError(value, 'expected a non-negative decimal string')
  }

  const [whole = '0', fraction = ''] = trimmed.split('.')

  if (fraction.length > USDC_DECIMALS) {
    throw new MoneyFormatError(value, `at most ${USDC_DECIMALS} decimal places are allowed`)
  }

  return BigInt(whole + fraction.padEnd(USDC_DECIMALS, '0'))
}

/**
 * Переводит base units обратно в decimal string.
 *
 * Незначащие нули в дробной части отбрасываются, но не меньше `minFractionDigits`,
 * чтобы цена выглядела как деньги: `10` → `10.00`.
 */
export function formatUsdc(units: bigint, minFractionDigits = 2): string {
  if (units < 0n) {
    throw new MoneyFormatError(units.toString(), 'negative amounts are not supported')
  }

  const divisor = 10n ** BigInt(USDC_DECIMALS)
  const whole = units / divisor
  const fraction = (units % divisor).toString().padStart(USDC_DECIMALS, '0')

  const trimmed = fraction.replace(/0+$/, '')
  const padded = trimmed.padEnd(Math.min(minFractionDigits, USDC_DECIMALS), '0')

  return padded.length > 0 ? `${whole}.${padded}` : whole.toString()
}

export interface EconomicsPreview {
  /** Полная цена архива — ровно её платит покупатель. */
  price: string
  /** Доля автора, 95%. */
  creator: string
  /** Доля платформы, 5%. */
  platform: string
  feeBps: number
}

/**
 * Превью разделения 95/5 для формы создания архива.
 *
 * Комиссия платформы отсекается вниз (целочисленное деление), автор получает остаток,
 * поэтому `creator + platform === price` при любой цене.
 *
 * Это ПРЕВЬЮ. Авторитетные числа приходят от backend в ответе на create.
 */
export function previewEconomics(price: string, feeBps: number = PLATFORM_FEE_BPS): EconomicsPreview {
  const totalUnits = parseUsdc(price)
  const platformUnits = (totalUnits * BigInt(feeBps)) / BPS_DENOMINATOR
  const creatorUnits = totalUnits - platformUnits

  return {
    price: formatUsdc(totalUnits),
    creator: formatUsdc(creatorUnits),
    platform: formatUsdc(platformUnits),
    feeBps,
  }
}

/**
 * Проверяет строку цены для формы. Возвращает текст ошибки или null.
 * Цена неизменяема после создания архива, поэтому проверяем строго.
 */
export function validatePriceInput(value: string): string | null {
  const trimmed = value.trim()

  if (trimmed.length === 0) return 'Укажите цену архива'
  if (!DECIMAL_PATTERN.test(trimmed)) return 'Цена должна быть числом, например 10.00'

  const fraction = trimmed.split('.')[1] ?? ''
  if (fraction.length > USDC_DECIMALS) {
    return `USDC поддерживает не более ${USDC_DECIMALS} знаков после запятой`
  }

  if (parseUsdc(trimmed) <= 0n) return 'Цена должна быть больше нуля'

  return null
}
