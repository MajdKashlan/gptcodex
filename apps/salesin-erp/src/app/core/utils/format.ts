const moneyFormatters = new Map<string, Intl.NumberFormat>();
const plainNumber = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Formats an amount in the document's own currency. Falls back to a plain
 * two-decimal number when the currency is unknown, instead of assuming USD.
 */
export function formatMoney(value: number | null | undefined, currency?: string | null): string {
  const amount = Number(value ?? 0);
  const code = (currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return plainNumber.format(amount);
  }
  let formatter = moneyFormatters.get(code);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    } catch {
      return `${plainNumber.format(amount)} ${code}`;
    }
    moneyFormatters.set(code, formatter);
  }
  return formatter.format(amount);
}

/** Quantity / plain number formatting. */
export function formatNumber(value: number | null | undefined, maxDigits = 2): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDigits }).format(Number(value ?? 0));
}
