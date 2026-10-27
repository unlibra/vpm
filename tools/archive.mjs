import { inflateRawSync, crc32 } from 'node:zlib';

const requireThat = (value, message) => { if (!value) throw Error(message); };
export function verifyArchive(bytes, manifestBytes) {
  const end = bytes.length - 22;
  requireThat(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50 && bytes.readUInt16LE(end + 20) === 0,
    'Invalid VPM ZIP end record.');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  requireThat(count > 0 && count === bytes.readUInt16LE(end + 8) && bytes.readUInt32LE(end + 4) === 0 && start + size === end,
    'Invalid VPM ZIP directory.');
  let cursor = start, total = 0;
  const files = new Map(), ranges = [];
  for (let i = 0; i < count; i++) {
    requireThat(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'Invalid ZIP entry.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), checksum = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24), length = bytes.readUInt16LE(cursor + 28);
    const extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    requireThat((flags & ~0x808) === 0 && [0, 8].includes(method) && bytes.readUInt16LE(cursor + 34) === 0 &&
      [0, 0o100000, 0o040000].includes(mode & 0o170000) && cursor + 46 + length + extra + comment <= end,
    'Unsupported ZIP entry metadata.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + length), name = nameBytes.toString('utf8');
    const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
    requireThat(/^[A-Za-z0-9_.\/-]+$/.test(normalized) && !normalized.startsWith('/') &&
      normalized.split('/').every(p => p && p !== '.' && p !== '..') && !files.has(name) &&
      !/^(Assets|Packages|Tests|Generated)(\/|$)/.test(normalized), 'Unsafe or duplicate ZIP path.');
    requireThat(local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50 &&
      bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method &&
      bytes.readUInt16LE(local + 26) === length, 'Invalid ZIP local header.');
    const payload = local + 30 + length + bytes.readUInt16LE(local + 28), payloadEnd = payload + compressed;
    requireThat(payloadEnd <= start && bytes.subarray(local + 30, local + 30 + length).equals(nameBytes) &&
      expanded <= 64 * 1024 * 1024 && (total += expanded) <= 64 * 1024 * 1024, 'Invalid ZIP payload bounds.');
    if ((flags & 8) === 0) requireThat(bytes.readUInt32LE(local + 14) === checksum && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === expanded, 'ZIP header sizes disagree.');
    const compressedBytes = bytes.subarray(payload, payloadEnd);
    const value = method === 0 ? compressedBytes : inflateRawSync(compressedBytes, { maxOutputLength: 64 * 1024 * 1024 });
    requireThat(value.length === expanded && crc32(value) === checksum, 'ZIP size or CRC mismatch.');
    files.set(name, value); ranges.push([local, payloadEnd]);
    cursor += 46 + length + extra + comment;
  }
  requireThat(cursor === end, 'ZIP directory length mismatch.');
  ranges.sort((a, b) => a[0] - b[0]);
  requireThat(ranges[0][0] === 0 && ranges.every((range, i) => i === 0 || range[0] >= ranges[i - 1][1]), 'Overlapping ZIP entries.');
  requireThat(files.get('package.json')?.equals(manifestBytes), 'ZIP package.json does not match the release manifest.');
  requireThat(files.get('LICENSE.txt')?.length > 0 && files.get('NOTICE.txt')?.length > 0, 'Missing ZIP license or notice.');
  return files;
}
