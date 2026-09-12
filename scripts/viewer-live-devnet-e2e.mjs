#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const OFFICIAL_DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const OFFICIAL_DEVNET_RPC = 'https://api.devnet.solana.com/';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_HTTP_BYTES = 16_384;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(field, reason) {
  throw new Error(`${field}: ${reason}`);
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) fail(name, 'required');
  return value;
}

function canonicalBase64(value, bytes, field) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(field, 'invalid Base64');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== bytes || decoded.toString('base64') !== value) {
    fail(field, `must be canonical padded Base64 for ${bytes} bytes`);
  }
  if (decoded.every((byte) => byte === 0)) fail(field, 'all-zero key rejected');
  return decoded;
}

function decodeBase58(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail(field, 'invalid Base58');
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) fail(field, 'invalid Base58');
    number = number * 58n + BigInt(digit);
  }
  const body = [];
  while (number > 0n) {
    body.push(Number(number & 255n));
    number >>= 8n;
  }
  body.reverse();
  const leading = value.match(/^1*/u)?.[0].length ?? 0;
  return Buffer.concat([Buffer.alloc(leading), Buffer.from(body)]);
}

function publicKey(value, field) {
  if (decodeBase58(value, field).length !== 32) fail(field, 'must decode to 32 bytes');
  return value;
}

function signature(value, field) {
  if (decodeBase58(value, field).length !== 64) fail(field, 'must decode to 64 bytes');
  return value;
}

function keyId(value, field) {
  if (!/^[a-z0-9_-]{1,32}$/.test(value)) fail(field, 'invalid frozen key_id');
  return value;
}

export function parseUsdc(value, field = 'price') {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{1,6})$/.exec(value);
  if (!match) fail(field, 'invalid USDC amount');
  return BigInt(match[1]) * 1_000_000n + BigInt(match[2].padEnd(6, '0'));
}

function rootHttps(value, field) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(field, 'invalid URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search ||
      parsed.hash || parsed.pathname !== '/' || !parsed.hostname ||
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
    fail(field, 'must be a non-loopback HTTPS root origin');
  }
  return parsed;
}

function httpsRpc(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('SOLARCH_DEVNET_RPC_URL', 'invalid URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !parsed.hostname) {
    fail('SOLARCH_DEVNET_RPC_URL', 'must be HTTPS without URL credentials or fragment');
  }
  return parsed;
}

export function validateLiveEnvironment(env, { evidence = false } = {}) {
  for (const fixtureName of ['SOLARCH_DEV_BACKEND_FIXTURE', 'SOLARCH_DEV_BACKEND_ORIGIN']) {
    if (env[fixtureName]) fail(fixtureName, 'fixture authority is forbidden in live Devnet mode');
  }
  if (required(env, 'SOLARCH_SOLANA_CLUSTER') !== 'devnet') {
    fail('SOLARCH_SOLANA_CLUSTER', 'must equal devnet');
  }
  if (required(env, 'SOLARCH_DEVNET_USDC_MINT') !== OFFICIAL_DEVNET_USDC_MINT) {
    fail('SOLARCH_DEVNET_USDC_MINT', 'does not match the current official Circle Devnet mint');
  }
  if (required(env, 'SOLARCH_USDC_DECIMALS') !== '6') {
    fail('SOLARCH_USDC_DECIMALS', 'must equal 6');
  }
  const backendOrigin = rootHttps(required(env, 'SOLARCH_BACKEND_ORIGIN'), 'SOLARCH_BACKEND_ORIGIN');
  const rpcUrl = httpsRpc(required(env, 'SOLARCH_DEVNET_RPC_URL'));
  const archiveKeyId = keyId(required(env, 'SOLARCH_ARCHIVE_TRUST_KEY_ID'), 'SOLARCH_ARCHIVE_TRUST_KEY_ID');
  const licenseKeyId = keyId(required(env, 'SOLARCH_LICENSE_TRUST_KEY_ID'), 'SOLARCH_LICENSE_TRUST_KEY_ID');
  const archiveKey = canonicalBase64(required(env, 'SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64'), 32, 'SOLARCH_ARCHIVE_TRUST_PUBLIC_KEY_B64');
  const licenseKey = canonicalBase64(required(env, 'SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64'), 32, 'SOLARCH_LICENSE_TRUST_PUBLIC_KEY_B64');
  if (archiveKey.equals(licenseKey)) {
    fail('trust anchors', 'archive and license roles must use distinct public keys');
  }
  const archivePath = path.resolve(required(env, 'SOLARCH_LIVE_ARCHIVE_PATH'));
  const archiveId = required(env, 'SOLARCH_ARCHIVE_ID');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(archiveId)) fail('SOLARCH_ARCHIVE_ID', 'invalid ID');
  const fingerprint = required(env, 'SOLARCH_ARCHIVE_FINGERPRINT');
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) fail('SOLARCH_ARCHIVE_FINGERPRINT', 'invalid fingerprint');
  const price = required(env, 'SOLARCH_PRICE_AMOUNT');
  const priceUnits = parseUsdc(price, 'SOLARCH_PRICE_AMOUNT');
  if (priceUnits <= 0n || priceUnits % 20n !== 0n) {
    fail('SOLARCH_PRICE_AMOUNT', 'must be positive and exactly divisible by 20 micro-USDC');
  }
  const creatorWallet = publicKey(required(env, 'SOLARCH_CREATOR_WALLET'), 'SOLARCH_CREATOR_WALLET');
  const platformWallet = publicKey(required(env, 'SOLARCH_PLATFORM_WALLET'), 'SOLARCH_PLATFORM_WALLET');
  const feePayerWallet = publicKey(required(env, 'SOLARCH_FEE_PAYER_WALLET'), 'SOLARCH_FEE_PAYER_WALLET');
  const buyerWallet = publicKey(required(env, 'SOLARCH_BUYER_WALLET'), 'SOLARCH_BUYER_WALLET');
  if (creatorWallet === platformWallet || buyerWallet === feePayerWallet) {
    fail('demo wallets', 'creator/platform and buyer/fee-payer roles must be independent');
  }
  const result = {
    backendOrigin,
    rpcUrl,
    archiveKeyId,
    licenseKeyId,
    archiveKey: archiveKey.toString('base64'),
    licenseKey: licenseKey.toString('base64'),
    archivePath,
    archiveId,
    fingerprint,
    price,
    priceUnits,
    creatorWallet,
    platformWallet,
    feePayerWallet,
    buyerWallet,
  };
  if (evidence) {
    result.paymentSignature = signature(required(env, 'SOLARCH_PAYMENT_TRANSACTION_SIGNATURE'), 'SOLARCH_PAYMENT_TRANSACTION_SIGNATURE');
    result.ataSignature = signature(required(env, 'SOLARCH_CREATOR_ATA_CREATION_SIGNATURE'), 'SOLARCH_CREATOR_ATA_CREATION_SIGNATURE');
    result.paymentReference = publicKey(required(env, 'SOLARCH_PAYMENT_REFERENCE'), 'SOLARCH_PAYMENT_REFERENCE');
    result.evidencePath = path.resolve(required(env, 'SOLARCH_LIVE_E2E_EVIDENCE_PATH'));
  }
  return result;
}

async function sha256File(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function execute(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 262_144) child.kill();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 262_144) child.kill();
    });
    child.once('error', () => reject(new Error('required child process could not start')));
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`required child process failed with exit code ${code}`));
    });
  });
}

async function readJsonResponse(response, field) {
  if (!response.ok) fail(field, `HTTP ${response.status}`);
  if (response.redirected) fail(field, 'redirect rejected');
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') fail(field, 'response must be application/json');
  const reader = response.body?.getReader();
  if (!reader) fail(field, 'missing response body');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_HTTP_BYTES) {
      await reader.cancel();
      fail(field, 'response exceeds bounded transport limit');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  } catch {
    fail(field, 'invalid JSON response');
  }
}

async function fetchJson(url, options, field) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), ...options });
  return readJsonResponse(response, field);
}

async function rpcCall(config, method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const value = await fetchJson(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }, `Devnet RPC ${method}`);
  if (value?.jsonrpc !== '2.0' || value?.id !== 1 || value?.error || value?.result === undefined) {
    fail(`Devnet RPC ${method}`, 'invalid JSON-RPC response');
  }
  return value.result;
}

function assertExactMetadata(metadata, header, config) {
  const expected = {
    archive_id: config.archiveId,
    archive_fingerprint: config.fingerprint,
    creator: { wallet: config.creatorWallet },
    price: { amount: config.price, currency: 'USDC' },
    platform_fee_bps: 500,
    license_policy: { max_devices: 1, allow_export: false, watermark_enabled: true },
    status: 'published',
  };
  for (const [field, actual, wanted] of [
    ['archive_id', metadata?.archive_id, expected.archive_id],
    ['archive_fingerprint', metadata?.archive_fingerprint, expected.archive_fingerprint],
    ['creator.wallet', metadata?.creator?.wallet, expected.creator.wallet],
    ['price.currency', metadata?.price?.currency, 'USDC'],
    ['platform_fee_bps', metadata?.platform_fee_bps, 500],
    ['license_policy.max_devices', metadata?.license_policy?.max_devices, 1],
    ['license_policy.allow_export', metadata?.license_policy?.allow_export, false],
    ['license_policy.watermark_enabled', metadata?.license_policy?.watermark_enabled, true],
    ['status', metadata?.status, 'published'],
  ]) {
    if (actual !== wanted) fail(`Backend metadata ${field}`, 'does not match trusted archive configuration');
  }
  if (parseUsdc(metadata?.price?.amount, 'Backend metadata price') !== config.priceUnits) {
    fail('Backend metadata price', 'does not match trusted archive price');
  }
  if (header.archive_id !== config.archiveId || header.creator_wallet !== config.creatorWallet ||
      parseUsdc(header.commercial_snapshot?.price_amount, 'archive price') !== config.priceUnits ||
      header.commercial_snapshot?.price_currency !== 'USDC' ||
      header.commercial_snapshot?.platform_fee_bps !== 500 ||
      header.license_snapshot?.max_devices !== 1 || header.license_snapshot?.allow_export !== false ||
      header.license_snapshot?.watermark_enabled !== true) {
    fail('archive Public Header', 'does not match the live exact-split demo contract');
  }
}

export async function runPreflight(env = process.env) {
  const config = validateLiveEnvironment(env);
  const stat = await fs.lstat(config.archivePath);
  if (!stat.isFile() || stat.isSymbolicLink() || path.extname(config.archivePath).toLowerCase() !== '.slr' ||
      stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
    fail('SOLARCH_LIVE_ARCHIVE_PATH', 'must be a bounded regular .slr file');
  }
  if (await sha256File(config.archivePath) !== config.fingerprint) {
    fail('SOLARCH_ARCHIVE_FINGERPRINT', 'does not match the exact archive bytes');
  }
  const cargo = env.CARGO || (process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  const verified = await execute(cargo, [
    'run', '--quiet', '-p', 'solarch-cli', '--', 'verify', '--archive', config.archivePath,
    '--signing-key-id', config.archiveKeyId, '--signing-public-key', config.archiveKey,
  ], { cwd: ROOT });
  const verification = JSON.parse(verified.stdout.trim());
  if (verification.verification !== 'AUTHENTICATED_CONTAINER' ||
      verification.archive_fingerprint !== config.fingerprint || verification.signing_key_id !== config.archiveKeyId) {
    fail('archive verification', 'Core did not authenticate the configured archive/key/fingerprint');
  }
  const inspected = await execute(cargo, ['run', '--quiet', '-p', 'solarch-cli', '--', 'inspect', config.archivePath], { cwd: ROOT });
  const inspection = JSON.parse(inspected.stdout.trim());
  if (inspection.verification !== 'UNVERIFIED' || !inspection.public_header) {
    fail('archive inspection', 'invalid bounded inspect result');
  }
  const genesis = await rpcCall(config, 'getGenesisHash', []);
  const officialGenesis = await fetchJson(OFFICIAL_DEVNET_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] }),
  }, 'official Devnet RPC genesis');
  if (genesis !== officialGenesis.result) fail('SOLARCH_DEVNET_RPC_URL', 'RPC is not on the current Solana Devnet cluster');
  const mint = await rpcCall(config, 'getTokenSupply', [OFFICIAL_DEVNET_USDC_MINT, { commitment: 'finalized' }]);
  if (mint?.value?.decimals !== 6) fail('Devnet USDC mint', 'on-chain decimals are not 6');
  const health = await fetchJson(new URL('v1/health', config.backendOrigin), {}, 'Backend health');
  const readiness = await fetchJson(new URL('v1/health/ready', config.backendOrigin), {}, 'Backend readiness');
  if (health?.status !== 'ok' || readiness?.status !== 'ready' ||
      readiness?.dependencies?.database !== 'ok' || readiness?.dependencies?.solana_rpc !== 'ok') {
    fail('Backend readiness', 'database or Solana RPC is not ready');
  }
  const metadata = await fetchJson(new URL(`v1/viewer/archives/${config.archiveId}`, config.backendOrigin), {}, 'Backend archive metadata');
  assertExactMetadata(metadata, inspection.public_header, config);
  return {
    config,
    summary: {
      cluster: 'devnet',
      rpc_host: config.rpcUrl.host,
      usdc_mint: OFFICIAL_DEVNET_USDC_MINT,
      usdc_decimals: 6,
      backend_host: config.backendOrigin.host,
      archive_id: config.archiveId,
      archive_fingerprint: config.fingerprint,
      archive_key_id: config.archiveKeyId,
      license_key_id: config.licenseKeyId,
      price: config.price,
      creator_share_micro_usdc: (config.priceUnits * 95n / 100n).toString(),
      platform_share_micro_usdc: (config.priceUnits * 5n / 100n).toString(),
    },
  };
}

function accountKeys(transaction) {
  return transaction.transaction.message.accountKeys.map((entry) =>
    typeof entry === 'string' ? { pubkey: entry, signer: false } : entry);
}

async function finalizedTransaction(config, transactionSignature, field) {
  const statuses = await rpcCall(config, 'getSignatureStatuses', [[transactionSignature], { searchTransactionHistory: true }]);
  if (statuses?.value?.[0]?.confirmationStatus !== 'finalized' || statuses.value[0].err !== null) {
    fail(field, 'transaction is not successfully finalized');
  }
  const transaction = await rpcCall(config, 'getTransaction', [transactionSignature, {
    encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0,
  }]);
  if (!transaction || transaction.meta?.err !== null) fail(field, 'finalized transaction unavailable or failed');
  return transaction;
}

function ownerDelta(transaction, mint, owner) {
  const pre = new Map((transaction.meta.preTokenBalances ?? []).map((item) => [item.accountIndex, item]));
  const post = new Map((transaction.meta.postTokenBalances ?? []).map((item) => [item.accountIndex, item]));
  let delta = 0n;
  for (const index of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(index);
    const after = post.get(index);
    const identity = after ?? before;
    if (identity?.mint !== mint || identity?.owner !== owner) continue;
    if (identity.uiTokenAmount?.decimals !== 6) fail('transaction token balance', 'unexpected decimals');
    delta += BigInt(after?.uiTokenAmount?.amount ?? '0') - BigInt(before?.uiTokenAmount?.amount ?? '0');
  }
  return delta;
}

function instructionProgramIds(transaction) {
  const outer = transaction.transaction.message.instructions ?? [];
  const inner = (transaction.meta.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  return [...outer, ...inner].map((item) => typeof item.programId === 'string' ? item.programId : item.programId?.toString?.());
}

async function validatePublicEvidenceFile(filename, config) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_HTTP_BYTES) {
    fail('SOLARCH_LIVE_E2E_EVIDENCE_PATH', 'must be a bounded regular JSON file');
  }
  const evidence = JSON.parse(await fs.readFile(filename, 'utf8'));
  const requiredTrue = [
    'backend_core_generated_archive', 'archive_opened_by_windows_association',
    'payment_and_entitlement_distinct', 'viewer_observed_finalized_before_activation',
    'device_a_real_signed_license_and_hpke', 'pdf_opened', 'image_opened', 'docx_opened',
    'xlsx_opened', 'watermark_verified', 'no_export_verified', 'cached_restart_verified',
    'cached_restart_backend_unavailable_verified', 'mandatory_live_refresh_verified',
    'mandatory_refresh_backend_unavailable_denied', 'device_b_independent_secure_store',
    'device_b_protected_content_denied', 'negative_cases_verified',
  ];
  if (evidence?.version !== 1 || evidence.archive_fingerprint !== config.fingerprint ||
      evidence.development_fixtures !== false || requiredTrue.some((field) => evidence[field] !== true)) {
    fail('live E2E evidence', 'missing or inconsistent mandatory manual/native checkpoint');
  }
  for (const field of ['payment_id', 'entitlement_id', 'license_id']) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(evidence[field] ?? '')) fail(`live E2E evidence ${field}`, 'invalid ID');
  }
  canonicalBase64(evidence.device_a_public_key, 32, 'live E2E evidence device_a_public_key');
  canonicalBase64(evidence.device_b_public_key, 32, 'live E2E evidence device_b_public_key');
  if (evidence.device_a_public_key === evidence.device_b_public_key ||
      evidence.device_b_rejection_code !== 'DEVICE_LIMIT_REACHED') {
    fail('live E2E evidence Device B', 'independent Device B/backend rejection not proven');
  }
  return evidence;
}

export async function runEvidence(env = process.env) {
  const preflight = await runPreflight(env);
  const config = validateLiveEnvironment(env, { evidence: true });
  const payment = await finalizedTransaction(config, config.paymentSignature, 'payment transaction');
  const keys = accountKeys(payment);
  if (keys[0]?.pubkey !== config.feePayerWallet || keys[0]?.signer !== true ||
      !keys.some((key) => key.pubkey === config.buyerWallet && key.signer === true) ||
      !keys.some((key) => key.pubkey === config.paymentReference) || !(payment.meta.fee > 0)) {
    fail('payment transaction', 'fee payer, buyer signer, reference, or fee evidence mismatch');
  }
  const creatorUnits = config.priceUnits * 95n / 100n;
  const platformUnits = config.priceUnits - creatorUnits;
  if (ownerDelta(payment, OFFICIAL_DEVNET_USDC_MINT, config.creatorWallet) !== creatorUnits ||
      ownerDelta(payment, OFFICIAL_DEVNET_USDC_MINT, config.platformWallet) !== platformUnits ||
      ownerDelta(payment, OFFICIAL_DEVNET_USDC_MINT, config.buyerWallet) !== -config.priceUnits) {
    fail('payment transaction', 'exact buyer debit or non-custodial 95/5 token deltas mismatch');
  }
  const ataCreation = await finalizedTransaction(config, config.ataSignature, 'creator ATA creation transaction');
  const ataKeys = accountKeys(ataCreation);
  if (ataKeys[0]?.pubkey !== config.feePayerWallet || ataKeys[0]?.signer !== true ||
      !instructionProgramIds(ataCreation).includes(ASSOCIATED_TOKEN_PROGRAM) || !(ataCreation.meta.fee > 0)) {
    fail('creator ATA creation transaction', 'SolArch fee payer or ATA program evidence mismatch');
  }
  const preIndices = new Set((ataCreation.meta.preTokenBalances ?? []).map((item) => item.accountIndex));
  const created = (ataCreation.meta.postTokenBalances ?? []).find((item) =>
    item.owner === config.creatorWallet && item.mint === OFFICIAL_DEVNET_USDC_MINT &&
    item.uiTokenAmount?.decimals === 6 && !preIndices.has(item.accountIndex));
  if (!created) fail('creator ATA creation transaction', 'new creator test-USDC ATA not proven');
  const evidence = await validatePublicEvidenceFile(config.evidencePath, config);
  return {
    ...preflight.summary,
    payment_transaction_signature: config.paymentSignature,
    payment_reference: config.paymentReference,
    fee_payer_wallet: config.feePayerWallet,
    creator_wallet: config.creatorWallet,
    platform_wallet: config.platformWallet,
    creator_ata: ataKeys[created.accountIndex]?.pubkey,
    creator_ata_creation_signature: config.ataSignature,
    payment_id: evidence.payment_id,
    entitlement_id: evidence.entitlement_id,
    license_id: evidence.license_id,
    device_a_public_key: evidence.device_a_public_key,
    device_b_public_key: evidence.device_b_public_key,
    device_b_rejection_code: evidence.device_b_rejection_code,
    finalized: true,
  };
}

async function build(env) {
  await runPreflight(env);
  if (process.platform !== 'win32') fail('live Devnet build', 'must run on native Windows');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  await execute(pnpm, [
    '--filter', '@solarch/viewer', 'tauri', 'build', '--features',
    'desktop-runtime,custom-protocol,live-devnet',
  ], { cwd: ROOT, env, stdio: 'inherit' });
}

export const LIVE_CHECKLIST = [
  'Build on native Windows with the live-devnet feature and no development-fixtures feature.',
  'On independent Device A, double-click the exact Backend/Core-generated .slr and verify Locked.',
  'Create one real Payment Intent, scan its QR with an external Devnet wallet, and sign test-USDC payment.',
  'Observe Locked pending/awaiting-finality until Backend reports finalized, then activate Device A.',
  'Open PDF, image, DOCX, and XLSX internally; verify the real buyer/license/archive watermark and no export path.',
  'Restart by double-click; verify cached reopen, offline Backend reopen, live mandatory refresh, and offline refresh denial.',
  'On independent Device B/VM, open the same bytes and obtain Backend DEVICE_LIMIT_REACHED; protected content stays denied.',
  'Populate only nonsecret public checkpoint JSON and run the evidence command for on-chain 95/5/fee-payer/ATA proof.',
];

export const EVIDENCE_TEMPLATE = {
  version: 1,
  archive_fingerprint: '<lowercase sha256>',
  development_fixtures: false,
  payment_id: '<public Backend ID>',
  entitlement_id: '<public Backend ID>',
  license_id: '<public Backend ID>',
  device_a_public_key: '<canonical padded Base64 public key>',
  device_b_public_key: '<different canonical padded Base64 public key>',
  device_b_rejection_code: 'DEVICE_LIMIT_REACHED',
  backend_core_generated_archive: false,
  archive_opened_by_windows_association: false,
  payment_and_entitlement_distinct: false,
  viewer_observed_finalized_before_activation: false,
  device_a_real_signed_license_and_hpke: false,
  pdf_opened: false,
  image_opened: false,
  docx_opened: false,
  xlsx_opened: false,
  watermark_verified: false,
  no_export_verified: false,
  cached_restart_verified: false,
  cached_restart_backend_unavailable_verified: false,
  mandatory_live_refresh_verified: false,
  mandatory_refresh_backend_unavailable_denied: false,
  device_b_independent_secure_store: false,
  device_b_protected_content_denied: false,
  negative_cases_verified: false,
};

async function main() {
  const command = process.argv[2];
  if (command === 'preflight') {
    process.stdout.write(`${JSON.stringify((await runPreflight()).summary, null, 2)}\n`);
  } else if (command === 'build') {
    await build(process.env);
  } else if (command === 'evidence') {
    process.stdout.write(`${JSON.stringify(await runEvidence(), null, 2)}\n`);
  } else if (command === 'checklist') {
    process.stdout.write(`${LIVE_CHECKLIST.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`);
  } else if (command === 'template') {
    process.stdout.write(`${JSON.stringify(EVIDENCE_TEMPLATE, null, 2)}\n`);
  } else {
    throw new Error('usage: viewer-live-devnet-e2e.mjs <preflight|build|evidence|checklist|template>');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`LIVE_DEVNET_E2E_BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
