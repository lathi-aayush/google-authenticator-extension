# Deep-Dive Technical Implementation

This file explains the cryptographic and protocol-level implementations executed within `popup.js`.

---

## 1. Protobuf Wire Parsing & Varint Reader

Google Authenticator exports multi-account payloads in a encoded Protocol Buffer message defined roughly as:

```protobuf
message MigrationPayload {
  repeated OtpParameters otp_parameters = 1;
  int32 version = 2;
  int32 batch_size = 3;
  int32 batch_index = 4;
  int32 batch_id = 5;
}

message OtpParameters {
  bytes secret = 1;
  string name = 2;
  string issuer = 3;
  int32 algorithm = 4;
  int32 digits = 5;
  int32 type = 6;
  int64 counter = 7;
}
Varint Reader Logic
Varints use the 7-bit payload approach where the highest bit (0x80) signals if additional bytes follow:

JavaScript
function readVarint(buffer, offset) {
  let result = 0, shift = 0, b;
  do {
    if (offset >= buffer.length) break;
    b = buffer[offset++];
    result |= (b & 0x7F) << shift; // Accumulate low 7 bits
    shift += 7;
  } while ((b & 0x80) !== 0);     // Continue if MSB is set
  return { value: result, newOffset: offset };
}
2. Base32 Conversion Encoding
Since Web Crypto and raw keys are transmitted as byte streams over Protobuf, they must be formatted into standard RFC 4648 Base32 strings for TOTP serialization.

JavaScript
function bytesToBase32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '', base32 = '';
  
  for (let i = 0; i < bytes.length; i++) {
    bits += bytes[i].toString(2).padStart(8, '0');
  }
  
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    base32 += alphabet[parseInt(bits.substr(i, 5), 2)];
  }
  
  return base32;
}
3. RFC 6238 TOTP Generation Algorithm
The TOTP calculation executes three operational phases:

Time-Step Counter:

Counter=⌊ 
30
Current Unix Timestamp
​
 ⌋
HMAC Computation:

HMAC-SHA1(Secret,Counter)
Dynamic Truncation:
Extract 4-byte dynamic offset integer using lower 4 bits of HMAC tail byte, masked by 0x7FFFFFFF, modulo 10 
6
 .

JavaScript
async function generateTOTP(base32Secret) {
  // 1. Decode Base32 secret to raw byte array
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let cleaned = base32Secret.replace(/=+$/, '').toUpperCase().replace(/ /g, '');
  let bits = '';
  for (let char of cleaned) {
    let val = alphabet.indexOf(char);
    if (val !== -1) bits += val.toString(2).padStart(5, '0');
  }
  let bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
  }

  // 2. Derive 8-byte big-endian time-step buffer
  const timeStep = Math.floor(Math.floor(Date.now() / 1000) / 30);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, timeStep, false); // Big endian offset write

  // 3. Web Crypto HMAC Sign
  const cryptoKey = await crypto.subtle.importKey(
    'raw', bytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, buffer);
  const hmac = new Uint8Array(signature);

  // 4. Dynamic Truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt = ((hmac[offset] & 0x7f) << 24) |
                  ((hmac[offset + 1] & 0xff) << 16) |
                  ((hmac[offset + 2] & 0xff) << 8) |
                  (hmac[offset + 3] & 0xff);

  return (codeInt % 1000000).toString().padStart(6, '0');
}