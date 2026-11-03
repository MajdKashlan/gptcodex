/** Builds an Excel-friendly CSV (UTF-8 BOM, CRLF, every cell quoted) and downloads it. */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<unknown>>): void {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  downloadBlob(filename, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[<>:"/\\|?*]/g, '-');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
