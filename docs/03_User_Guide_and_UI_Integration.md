# User Interface & Extension Setup Guide

## Manifest V3 Requirements

Ensure your extension includes proper permissions inside `manifest.json`.

```json
{
  "manifest_version": 3,
  "name": "Offline Google Authenticator Importer",
  "version": "1.0.0",
  "action": {
    "default_popup": "popup.html"
  },
  "permissions": [
    "storage"
  ]
}
Extension Interface (popup.html)
To support both QR Code scanning and direct link text inputs, your HTML document layout should match this markup structure:

HTML
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { width: 320px; font-family: sans-serif; padding: 10px; margin: 0; }
    .input-section { margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
    .field-group { margin-bottom: 8px; }
    label { font-size: 11px; font-weight: bold; display: block; margin-bottom: 3px; }
    input[type="text"] { width: 95%; padding: 5px; font-size: 11px; }
    button { width: 100%; padding: 6px; margin-top: 4px; cursor: pointer; }
    .account-card { border: 1px solid #ccc; padding: 8px; border-radius: 4px; margin-bottom: 8px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; }
    .account-name { font-weight: bold; font-size: 12px; }
    .delete-btn { width: auto; padding: 0 5px; border: none; background: transparent; color: red; cursor: pointer; font-size: 14px; }
    .totp-code { font-size: 20px; font-weight: bold; letter-spacing: 2px; color: #1a73e8; cursor: pointer; margin: 5px 0; }
    .timer { font-size: 10px; color: #666; }
  </style>
</head>
<body>

  <div class="input-section">
    <div class="field-group">
      <label for="qrInput">Upload QR Code Image:</label>
      <input type="file" id="qrInput" accept="image/*" />
    </div>

    <div class="field-group" style="margin-top: 10px;">
      <label for="urlInput">Or Paste otpauth-migration Link:</label>
      <input type="text" id="urlInput" placeholder="otpauth-migration://offline?data=..." />
      <button id="submitUrlBtn">Import Link</button>
    </div>
  </div>

  <div id="accountList"></div>

  <script src="zxing.min.js"></script>
  <script src="popup.js"></script>
</body>
</html>
Verification & Workflow
Option 1: File Reader Flow
Export accounts from Google Authenticator App -> Transfer Accounts -> Export.

Take a screenshot or picture of the QR code.

Open the extension popup, click Choose File under Upload QR Code Image.

The ZXing engine reads the image matrix, isolates the payload query parameters, and updates local storage.

Option 2: Direct URL Import Flow
If using a desktop QR reader (e.g., standard ZXing web interface) to scan the QR, copy the raw resulting string (otpauth-migration://offline?data=...).

Paste the string into the Or Paste otpauth-migration Link text box inside the popup.

Click Import Link.

Payload will instantly decode, parse the secrets via Protobuf, and show refreshed codes updated every second.