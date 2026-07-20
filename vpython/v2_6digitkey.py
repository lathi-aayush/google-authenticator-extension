import base64
import hashlib
import hmac
import struct
import time
import urllib.parse as urlparse


def read_varint(data: bytes, offset: int):
    """Reads a protobuf varint integer."""
    result = 0
    shift = 0
    while offset < len(data):
        b = data[offset]
        offset += 1
        result |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            break
        shift += 7
    return result, offset


def parse_protobuf_payload(data: bytes):
    """Parses raw Protobuf payload without needing google_auth_pb2 or protobuf_generated_python."""
    accounts = []
    offset = 0

    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field_num = tag >> 3
        wire_type = tag & 0x07

        if field_num == 1 and wire_type == 2:  # otp_parameters field
            param_length, offset = read_varint(data, offset)
            param_bytes = data[offset : offset + param_length]
            offset += param_length

            p_offset = 0
            otp = {"secret": b"", "name": "", "issuer": ""}

            while p_offset < len(param_bytes):
                p_tag, p_offset = read_varint(param_bytes, p_offset)
                p_field = p_tag >> 3
                p_wire = p_tag & 0x07

                if p_field == 1 and p_wire == 2:  # secret
                    sec_len, p_offset = read_varint(param_bytes, p_offset)
                    otp["secret"] = param_bytes[p_offset : p_offset + sec_len]
                    p_offset += sec_len
                elif p_field == 2 and p_wire == 2:  # account name
                    str_len, p_offset = read_varint(param_bytes, p_offset)
                    otp["name"] = param_bytes[
                        p_offset : p_offset + str_len
                    ].decode("utf-8", errors="ignore")
                    p_offset += str_len
                elif p_field == 3 and p_wire == 2:  # issuer
                    str_len, p_offset = read_varint(param_bytes, p_offset)
                    otp["issuer"] = param_bytes[
                        p_offset : p_offset + str_len
                    ].decode("utf-8", errors="ignore")
                    p_offset += str_len
                else:
                    if p_wire == 0:
                        _, p_offset = read_varint(param_bytes, p_offset)
                    elif p_wire == 2:
                        skip_len, p_offset = read_varint(param_bytes, p_offset)
                        p_offset += skip_len

            accounts.append(otp)
        else:
            if wire_type == 0:
                _, offset = read_varint(data, offset)
            elif wire_type == 2:
                skip_len, offset = read_varint(data, offset)
                offset += skip_len

    return accounts


def generate_totp_code(secret_base32: str) -> str:
    """Calculates live 6-digit TOTP code offline."""
    secret_base32 = secret_base32.replace(" ", "").upper()
    missing_padding = len(secret_base32) % 8
    if missing_padding:
        secret_base32 += "=" * (8 - missing_padding)

    key = base64.b32decode(secret_base32)
    time_step = int(time.time()) // 30
    time_bytes = struct.pack(">Q", time_step)

    hmac_hash = hmac.new(key, time_bytes, hashlib.sha1).digest()
    offset = hmac_hash[-1] & 0x0F
    code_bytes = hmac_hash[offset : offset + 4]
    code_int = struct.unpack(">I", code_bytes)[0] & 0x7FFFFFFF

    return f"{code_int % 1_000_000:06d}"


def process_migration_url(migration_url: str):
    parsed_url = urlparse.urlparse(migration_url)
    params = urlparse.parse_qs(parsed_url.query, strict_parsing=True)

    if "data" not in params:
        print("Error: Invalid migration URL format.")
        return

    # Base64 decode raw string from parameter
    b64_data = params["data"][0].replace(" ", "+")
    raw_proto_bytes = base64.b64decode(b64_data)

    accounts = parse_protobuf_payload(raw_proto_bytes)

    print(f"\nExtracted {len(accounts)} Account(s):\n" + "=" * 40)
    for i, acc in enumerate(accounts, 1):
        # Convert raw Protobuf binary bytes to standard Base32 string
        base32_secret = str(base64.b32encode(acc["secret"]), "utf-8").replace(
            "=", ""
        )
        live_totp = generate_totp_code(base32_secret)

        print(f"[{i}] Account:    {acc['name']}")
        print(f"    Issuer:     {acc['issuer'] or 'N/A'}")
        print(f"    Base32 Key: {base32_secret}")
        print(f"    Live 2FA:   {live_totp}")
        print("-" * 40)


if __name__ == "__main__":
    # Paste your Google Authenticator export QR code text here:
    url = "otpauth-migration://offline?data= REPLACE WITH YOUR URL"
    process_migration_url(url)