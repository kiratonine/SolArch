const PAYMENT_AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function formatPaymentAmount(value: string): string {
  const match = PAYMENT_AMOUNT_PATTERN.exec(value);
  if (!match) return value;

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(3, "0");
  let hundredths = (whole * 100n) + BigInt(fraction.slice(0, 2));
  if (fraction[2] >= "5") hundredths += 1n;

  const formattedWhole = hundredths / 100n;
  const formattedFraction = (hundredths % 100n).toString().padStart(2, "0");
  return `${formattedWhole}.${formattedFraction}`;
}
