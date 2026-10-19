// ZIP STORE format: exact UTF-8 bytes, no compression dependency or async work
// during the completion gesture. One archive reduces upload request count.
export function createSessionZip(files) {
  const encoder = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const seen = new Set();
  for (const file of files) {
    if (!file.filename || file.filename.startsWith('/') || file.filename.includes('\\') ||
        file.filename.split('/').some(part => !part || part === '..' || part === '.') || seen.has(file.filename)) {
      throw new Error('Unsafe or duplicate ZIP filename');
    }
    seen.add(file.filename);
    const name = encoder.encode(file.filename), bytes = encoder.encode(file.text);
    if (name.length > 65535 || bytes.length > 0xffffffff) throw new Error('ZIP entry too large');
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true); h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length), e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true);
    e.setUint16(8, 0x800, true); e.setUint16(14, 33, true);
    e.setUint32(16, crc, true); e.setUint32(20, bytes.length, true);
    e.setUint32(24, bytes.length, true); e.setUint16(28, name.length, true);
    e.setUint32(42, offset, true); entry.set(name, 46);
    parts.push(header, bytes); central.push(entry); offset += header.length + bytes.length;
  }
  const directorySize = central.reduce((size, entry) => size + entry.length, 0);
  if (files.length > 65535 || offset + directorySize > 0xffffffff) throw new Error('ZIP64 not supported');
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  const zip = new Uint8Array(offset + directorySize + end.length);
  let position = 0;
  for (const part of [...parts, ...central, end]) { zip.set(part, position); position += part.length; }
  return zip;
}

export function zipToBase64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}
