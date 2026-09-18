/**
 * Проверка адреса Solana по форме.
 *
 * Криптографии здесь нет и быть не может: фронт не строит транзакций и не трогает
 * ключи (`docs/SPEC.md`, non-custodial). Проверяется ровно одно — что строка вообще
 * является адресом: алфавит base58 и ровно 32 байта после декодирования.
 *
 * Этого достаточно, чтобы поймать опечатку, обрезанную при пересылке строку и
 * вставленный вместо адреса hex или подпись транзакции. Существует ли счёт в сети
 * и готов ли у него USDC ATA — знает только backend (`payout_account_ready`).
 */

/** Алфавит Bitcoin: из него исключены 0, O, I и l — те, что путают на глаз. */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Публичный ключ ed25519 — всегда 32 байта. */
const ADDRESS_BYTES = 32

/**
 * Декодирует base58 в байты. Возвращает `null`, если строка вышла за алфавит.
 *
 * Число накапливается в массиве байтов от младшего к старшему, поэтому в конце
 * массив разворачивается. Ведущие единицы — это ведущие нулевые байты: значения
 * они не несут, но длину задают, и без них адрес System Program оказался бы пустым.
 */
function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0) return null

  const bytes: number[] = []

  for (const char of value) {
    const digit = ALPHABET.indexOf(char)
    if (digit < 0) return null

    let carry = digit
    for (let i = 0; i < bytes.length; i += 1) {
      carry += (bytes[i] ?? 0) * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (let i = 0; i < value.length && value[i] === '1'; i += 1) {
    bytes.push(0)
  }

  return Uint8Array.from(bytes.reverse())
}

/** Похожа ли строка на адрес Solana. Пробелы вокруг обрезаются: адрес вставляют из буфера. */
export function isSolanaAddress(value: string): boolean {
  const decoded = decodeBase58(value.trim())
  return decoded !== null && decoded.length === ADDRESS_BYTES
}
