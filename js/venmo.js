// Venmo links open the app on a phone (or venmo.com on a computer) with everything filled in.

export function cleanHandle(handle) {
  return String(handle || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^A-Za-z0-9_-]/g, '');
}

// kind: 'pay' (you send them money) or 'charge' (you request money from them).
export function venmoUrl({ handle, cents, note, kind = 'pay' }) {
  const params = new URLSearchParams({
    txn: kind,
    audience: 'private',
    recipients: cleanHandle(handle),
    amount: (cents / 100).toFixed(2),
    note: note || 'Poker',
  });
  return `https://venmo.com/?${params}`;
}
