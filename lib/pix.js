// Gera o "Pix copia e cola" (BR Code estático) a partir da chave Pix da loja.
const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

function crc16(str) {
  let crc = 0xffff;
  for (const ch of Buffer.from(str, 'utf8')) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Bancos só aceitam letras sem acento, números e espaço em nome e cidade
const clean = (t, max) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, max) || 'NA';

function pixPayload({ key, name, city, amount, txid }) {
  const account = tlv('00', 'br.gov.bcb.pix') + tlv('01', String(key).trim());
  let p = tlv('00', '01') + tlv('26', account) + tlv('52', '0000') + tlv('53', '986');
  if (amount > 0) p += tlv('54', amount.toFixed(2));
  p += tlv('58', 'BR') + tlv('59', clean(name, 25)) + tlv('60', clean(city, 15));
  p += tlv('62', tlv('05', (txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'));
  p += '6304';
  return p + crc16(p);
}

module.exports = { pixPayload, crc16 };
