import { invoke } from "@tauri-apps/api/core";

export type VerifiedArchive = {
  title: string;
  creatorWallet: string;
  priceAmount: string;
  priceCurrency: "USDC";
  archiveId: string;
  maxDevices: number;
  allowExport: false;
  watermarkEnabled: true;
  fingerprint: string;
};

export type ViewerCommandError = {
  code: string;
  message_key: string;
};

export function getDevicePublicKey(): Promise<string> {
  return invoke<string>("get_device_public_key");
}

export function verifyArchive(path: string): Promise<VerifiedArchive> {
  return invoke<VerifiedArchive>("open_archive", { path });
}

export function closeArchive(): Promise<void> {
  return invoke<void>("close_archive");
}

export function errorMessageKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<ViewerCommandError>;
  return typeof candidate.message_key === "string" ? candidate.message_key : null;
}
