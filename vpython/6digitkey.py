import base64
import hashlib
import hmac
import struct
import time


def get_totp_token(secret):
    # 1. Clean and decode the Base32 secret key
    # Add padding if missing so base32 decoding works
    secret = secret.replace(" ", "").upper()
    missing_padding = len(secret) % 8
    if missing_padding:
        secret += "=" * (8 - missing_padding)

    key = base64.b32decode(secret)

    # 2. Get the current 30-second time step (8-byte big-endian integer)
    time_step = int(time.time()) // 30
    time_bytes = struct.pack(">Q", time_step)

    # 3. Calculate HMAC-SHA1
    hmac_hash = hmac.new(key, time_bytes, hashlib.sha1).digest()

    # 4. Dynamic Truncation to convert 20-byte hash into a 6-digit code
    offset = hmac_hash[-1] & 0x0F
    code_bytes = hmac_hash[offset : offset + 4]
    code_int = struct.unpack(">I", code_bytes)[0] & 0x7FFFFFFF

    # Get the last 6 digits and format with leading zeros if needed
    code = f"{code_int % 1_000_000:06d}"
    return code


# Replace with your 16-character Base32 secret key
secret_key = "enter your secret key here"
print(f"Your 6-digit 2FA code is: {get_totp_token(secret_key)}")