// Every field is quoted; quotes are doubled, record separators are CRLF.
// Protect formula-like cells before quoting, including leading whitespace,
// control characters and quote-wrapped formula prefixes. Ordinary interior '='
// is preserved. An apostrophe is intentionally visible in non-spreadsheet readers.
export function csvCell(value: string | null | undefined) {
  const text = value ?? ''
  const dangerous = /^[\s\u0000-\u001f\u007f-\u009f"']*[=+\-@]/u.test(text)
    || /^[\s"']*[\u0000-\u001f\u007f-\u009f]/u.test(text)
  const safe = dangerous ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function serializeCSV(rows: readonly (readonly (string | null | undefined)[])[]) {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
