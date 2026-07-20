# Google Authenticator QR/Link Importer Architecture Overview

## Executive Summary
This document details the architectural design and data pipeline of an offline Chrome Extension capable of parsing Google Authenticator migration URIs (`otpauth-migration://offline?data=...`), decoding Protocol Buffers payloads, and generating real-time Time-based One-Time Passwords (TOTP) strictly on-device without external server calls.

---

## Technical Stack
* **Runtime**: Google Chrome Extension (Manifest V3)
* **Decoder Library**: ZXing (Zebra Crossing) JS library for visual QR extraction
* **Serialization Protocol**: Google Protocol Buffers (Custom JS Varint & Wire-Type Parser)
* **Crypto Primitive**: Web Crypto API (`crypto.subtle`) for HMAC-SHA1 signature computation
* **Storage Engine**: `chrome.storage.local` for client-side encrypted/isolated persistence

---

## System Architecture Diagram

+-------------------------------------------------------------------+
|                            User Interface                         |
|  +---------------------------+    +----------------------------+  |
|  | File Upload ()     |    | Direct Link Input () |  |
|  +-------------+-------------+    +--------------+-------------+  |
+----------------|---------------------------------|----------------+
| (Image File)                    | (Raw String)
v                                 |
+------------------------------------+             |
| ZXing Engine (decodeFromImage)   |             |
+----------------+-------------------+             |
| (Decoded URL String)            |
+----------------+----------------+
|
v
+-------------------------------------------------------------------+
| processMigrationUrlString(urlString)                            |
|                                                                   |
| 1. Extract data query parameter.                                |
| 2. Standardize Base64 padding (/ /g -> +).                     |
| 3. Convert Base64 -> Binary Uint8Array (atob).                  |
+---------------------------------+---------------------------------+
|
v
+-------------------------------------------------------------------+
| Custom Protobuf Parser (parseProtobuf)                          |
|                                                                   |
| 1. Read Field Tag & Wire Types via Varint Decoding (readVarint).|
| 2. Extract nested MigrationPayload (Field 1).                   |
| 3. Parse OtpParameters: Secret (F1), Name (F2), Issuer (F3).    |
+---------------------------------+---------------------------------+
|
v
+-------------------------------------------------------------------+
| Secret Normalization (bytesToBase32)                            |
| Converts raw secret bytes into RFC 4648 Base32 string format.     |
+---------------------------------+---------------------------------+
|
v
+-------------------------------------------------------------------+
| Chrome Storage (chrome.storage.local)                           |
| Array append: [{ name, issuer, secret }, ...]                  |
+---------------------------------+---------------------------------+
|
v
+-------------------------------------------------------------------+
| Ticker Engine & UI Renderer (renderAccounts)                   |
|                                                                   |
| 1. Calculates current epoch Unix time-step: floor(time / 30).  |
| 2. Computes HMAC-SHA1 signature via Web Crypto API.               |
| 3. Dynamic truncation to extract 6-digit code.                    |
| 4. Renders interface card & sets 1-second refresh ticker.         |
+-------------------------------------------------------------------+


---

## Security Model
1. **Zero Exfiltration**: No network requests (`fetch`/`XMLHttpRequest`) are made. Secret processing is fully air-gapped within the extension background/popup process.
2. **Local Isolation**: Keys are preserved inside local storage sandboxed specifically to the browser profile extensions container.
3. **Hardware Acceleration**: SHA-1 cryptographic primitives run via native Web Crypto API bindings instead of pure JS code, minimizing memory leaks and timing attacks.
