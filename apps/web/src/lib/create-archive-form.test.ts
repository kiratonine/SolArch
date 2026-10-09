import { describe, expect, it } from 'vitest'

import {
  emptyCreateArchiveValues,
  toCreateArchiveRequest,
  validateCreateArchive,
  type CreateArchiveValues,
} from './create-archive-form'

/**
 * Проверка формы создания архива.
 *
 * Возвращаются коды, а не фразы: текст живёт в словаре и существует на двух языках.
 * Тело запроса собирается здесь же — так поля формы и поля контракта сходятся
 * в одном месте, а не расползаются по компоненту.
 */

const VALID: CreateArchiveValues = {
  title: 'Solana Program Security',
  shortDescription: 'Аудит программ на Anchor: чек-лист и разборы',
  description: 'Полный разбор двенадцати уязвимостей.',
  price: '10.00',
  payoutWallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  allowExport: false,
  watermarkEnabled: true,
}

describe('validateCreateArchive', () => {
  it('пропускает заполненную форму', () => {
    expect(validateCreateArchive(VALID)).toEqual({})
  })

  it('называет каждое незаполненное обязательное поле', () => {
    expect(validateCreateArchive(emptyCreateArchiveValues())).toEqual({
      title: 'titleRequired',
      shortDescription: 'shortDescriptionRequired',
      price: 'priceRequired',
      payoutWallet: 'payoutWalletRequired',
    })
  })

  it('не считает пробелы заполнением', () => {
    const problems = validateCreateArchive({ ...VALID, title: '   ' })
    expect(problems.title).toBe('titleRequired')
  })

  it('держит тексты в пределах, на которые рассчитаны карточка и страница', () => {
    expect(validateCreateArchive({ ...VALID, title: 'a'.repeat(121) }).title).toBe('titleTooLong')
    expect(
      validateCreateArchive({ ...VALID, shortDescription: 'a'.repeat(201) }).shortDescription,
    ).toBe('shortDescriptionTooLong')
    expect(validateCreateArchive({ ...VALID, description: 'a'.repeat(4001) }).description).toBe(
      'descriptionTooLong',
    )
  })

  it('описание необязательно', () => {
    expect(validateCreateArchive({ ...VALID, description: '' })).toEqual({})
  })

  it('передаёт причину отказа по цене как есть', () => {
    expect(validateCreateArchive({ ...VALID, price: 'abc' }).price).toBe('priceFormat')
    expect(validateCreateArchive({ ...VALID, price: '0' }).price).toBe('priceNotPositive')
    expect(validateCreateArchive({ ...VALID, price: '1.1234567' }).price).toBe('pricePrecision')
  })

  it('отличает пустой адрес выплат от неверного', () => {
    expect(validateCreateArchive({ ...VALID, payoutWallet: '' }).payoutWallet).toBe(
      'payoutWalletRequired',
    )
    expect(validateCreateArchive({ ...VALID, payoutWallet: 'not-an-address' }).payoutWallet).toBe(
      'payoutWalletInvalid',
    )
  })
})

describe('toCreateArchiveRequest', () => {
  it('собирает тело запроса по контракту', () => {
    expect(toCreateArchiveRequest(VALID)).toEqual({
      title: 'Solana Program Security',
      short_description: 'Аудит программ на Anchor: чек-лист и разборы',
      description: 'Полный разбор двенадцати уязвимостей.',
      price: { currency: 'USDC', amount: '10.00' },
      creator_payout_wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
    })
  })

  /**
   * Найдено на живом экране: автор набирал «12.5», разбивка показывала «12.50»,
   * а в архив уходило «12.5» — и карточка кабинета печатала цену в таком виде.
   * Уходить должно ровно то число, которое человек увидел.
   */
  it('отправляет цену в том виде, в каком показал её автору', () => {
    expect(toCreateArchiveRequest({ ...VALID, price: '12.5' }).price.amount).toBe('12.50')
    expect(toCreateArchiveRequest({ ...VALID, price: '7' }).price.amount).toBe('7.00')
    expect(toCreateArchiveRequest({ ...VALID, price: '0.500000' }).price.amount).toBe('0.50')
    // Значащая точность дальше двух знаков не теряется: это USDC, а не рубли.
    expect(toCreateArchiveRequest({ ...VALID, price: '1.234567' }).price.amount).toBe('1.234567')
  })

  it('обрезает пробелы вокруг введённого', () => {
    const request = toCreateArchiveRequest({
      ...VALID,
      title: '  Solana Program Security  ',
      price: ' 10.00 ',
      payoutWallet: `  ${VALID.payoutWallet}\n`,
    })

    expect(request.title).toBe('Solana Program Security')
    expect(request.price.amount).toBe('10.00')
    expect(request.creator_payout_wallet).toBe(VALID.payoutWallet)
  })

  it('переносит переключатели политики и держит max_devices равным одному', () => {
    const request = toCreateArchiveRequest({
      ...VALID,
      allowExport: true,
      watermarkEnabled: false,
    })

    expect(request.license_policy).toEqual({
      max_devices: 1,
      allow_export: true,
      watermark_enabled: false,
    })
  })
})
