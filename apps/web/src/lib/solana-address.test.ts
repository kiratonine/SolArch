import { describe, expect, it } from 'vitest'

import { isSolanaAddress } from './solana-address'

/**
 * Адрес выплат — единственное поле формы, ошибка в котором стоит денег: 95% уходят
 * туда, что вписал автор, и вернуть их некому. Поэтому проверяем не длину строки,
 * а то, что она вообще является адресом: base58 и ровно 32 байта после декодирования.
 */

/** Настоящий адрес, 44 символа. Тот же, что у автора в моке. */
const REAL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

describe('isSolanaAddress', () => {
  it('принимает настоящий адрес', () => {
    expect(isSolanaAddress(REAL)).toBe(true)
  })

  it('принимает адрес из одних единиц — это 32 нулевых байта', () => {
    // System Program. Короче остальных на вид, но той же длины в байтах.
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true)
  })

  it('обрезает пробелы вокруг: адрес приходит вставкой из буфера', () => {
    expect(isSolanaAddress(`  ${REAL}\n`)).toBe(true)
  })

  it('отвергает символы вне алфавита base58', () => {
    // Ноль, заглавная O, заглавная I и строчная l исключены из алфавита именно
    // потому, что их путают на глаз.
    expect(isSolanaAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAs0')).toBe(false)
    expect(isSolanaAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsO')).toBe(false)
    expect(isSolanaAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsI')).toBe(false)
    expect(isSolanaAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsl')).toBe(false)
  })

  it('отвергает адрес короче 32 байт', () => {
    expect(isSolanaAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA8')).toBe(false)
  })

  it('отвергает адрес длиннее 32 байт', () => {
    expect(isSolanaAddress(`${REAL}zz`)).toBe(false)
  })

  it('отвергает пустую строку и одни пробелы', () => {
    expect(isSolanaAddress('')).toBe(false)
    expect(isSolanaAddress('   ')).toBe(false)
  })

  it('отвергает подпись транзакции: она base58, но длиннее адреса', () => {
    expect(
      isSolanaAddress(
        '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW',
      ),
    ).toBe(false)
  })
})
