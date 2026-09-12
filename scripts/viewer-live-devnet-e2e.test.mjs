import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVIDENCE_TEMPLATE,
  LIVE_CHECKLIST,
  OFFICIAL_DEVNET_USDC_MINT,
  parseUsdc,
  validateLiveEnvironment,
} from './viewer-live-devnet-e2e.mjs';

function validEnvironment() {
  return {
    SOLARCH_SOLANA_CLUSTER: 'devnet',
    SOLARCH_DEVNET_RPC_URL: 'https://api.devnet.solana.com/',
    SOLARCH_DEVNET_USDC_MINT: OFFICIAL_DEVNET_USDC_MINT,
    SOLARCH_USDC_DECIMALS: '6',
    SOLARCH_BACKEND_ORIGIN: 'https://api.demo.solarch.example/',
    SOLARCH_ARCHIVE_TRUST_KEY_ID: 'arc-devnet-01',
    SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64: 'A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=',
    SOLARCH_LICENSE_TRUST_KEY_ID: 'lic-devnet-01',
    SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64: 'JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0=',
    SOLARCH_LIVE_ARCHIVE_PATH: '/tmp/example.slr',
    SOLARCH_ARCHIVE_ID: 'arc_demo_01',
    SOLARCH_ARCHIVE_FINGERPRINT: 'a'.repeat(64),
    SOLARCH_PRICE_AMOUNT: '10.000000',
    SOLARCH_CREATOR_WALLET: '11111111111111111111111111111111',
    SOLARCH_PLATFORM_WALLET: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    SOLARCH_FEE_PAYER_WALLET: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    SOLARCH_BUYER_WALLET: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  };
}

test('live preflight configuration is explicit, exact-split and role-separated', () => {
  const config = validateLiveEnvironment(validEnvironment());
  assert.equal(config.priceUnits, 10_000_000n);
  assert.equal(config.backendOrigin.origin, 'https://api.demo.solarch.example');
  assert.ok(LIVE_CHECKLIST.some((line) => line.includes('Device B')));
  assert.equal(EVIDENCE_TEMPLATE.development_fixtures, false);
});

test('fixture authority, wrong network/mint and ambiguous split fail closed', () => {
  for (const mutate of [
    (env) => { env.SOLARCH_DEV_BACKEND_FIXTURE = 'part04-payment'; },
    (env) => { env.SOLARCH_SOLANA_CLUSTER = 'mainnet-beta'; },
    (env) => { env.SOLARCH_DEVNET_USDC_MINT = '11111111111111111111111111111111'; },
    (env) => { env.SOLARCH_PRICE_AMOUNT = '1.000001'; },
    (env) => { env.SOLARCH_BACKEND_ORIGIN = 'http://localhost:3000/'; },
    (env) => { env.SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64 = env.SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64; },
  ]) {
    const env = validEnvironment();
    mutate(env);
    assert.throws(() => validateLiveEnvironment(env));
  }
});

test('USDC parser stays integer-only and bounded to six decimals', () => {
  assert.equal(parseUsdc('4.990000'), 4_990_000n);
  assert.equal(parseUsdc('0.000020'), 20n);
  for (const value of ['1', '01.00', '1.0000001', '-1.00', '1e2', '']) {
    assert.throws(() => parseUsdc(value));
  }
});

test('evidence mode requires only public proof inputs and independent signatures', () => {
  const env = validEnvironment();
  assert.throws(() => validateLiveEnvironment(env, { evidence: true }), /SOLARCH_PAYMENT_TRANSACTION_SIGNATURE/);
  env.SOLARCH_PAYMENT_TRANSACTION_SIGNATURE = '1'.repeat(64);
  env.SOLARCH_CREATOR_ATA_CREATION_SIGNATURE = '1'.repeat(64);
  env.SOLARCH_PAYMENT_REFERENCE = '11111111111111111111111111111111';
  env.SOLARCH_LIVE_E2E_EVIDENCE_PATH = '/tmp/evidence.json';
  assert.equal(validateLiveEnvironment(env, { evidence: true }).paymentReference, env.SOLARCH_PAYMENT_REFERENCE);
});
