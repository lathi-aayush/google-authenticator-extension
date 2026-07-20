// --- 1. Protobuf Varint and Payload Reader ---
function readVarint(buffer, offset) {
  let result = 0, shift = 0, b;
  do {
    if (offset >= buffer.length) break;
    b = buffer[offset++];
    result |= (b & 0x7F) << shift;
    shift += 7;
  } while ((b & 0x80) !== 0);
  return { value: result, newOffset: offset };
}

function parseProtobuf(data) {
  const accounts = [];
  let offset = 0;

  while (offset < data.length) {
    let { value: tag, newOffset } = readVarint(data, offset);
    offset = newOffset;
    let fieldNum = tag >> 3, wireType = tag & 0x07;

    if (fieldNum === 1 && wireType === 2) {
      let { value: len, newOffset: o1 } = readVarint(data, offset);
      let paramBytes = data.subarray(o1, o1 + len);
      offset = o1 + len;

      let pOffset = 0;
      let otp = { secret: null, name: "", issuer: "" };

      while (pOffset < paramBytes.length) {
        let { value: pTag, newOffset: pO1 } = readVarint(paramBytes, pOffset);
        pOffset = pO1;
        let pField = pTag >> 3, pWire = pTag & 0x07;

        if (pField === 1 && pWire === 2) { // Secret bytes
          let { value: sLen, newOffset: sO } = readVarint(paramBytes, pOffset);
          otp.secret = paramBytes.subarray(sO, sO + sLen);
          pOffset = sO + sLen;
        } else if (pField === 2 && pWire === 2) { // Name
          let { value: nLen, newOffset: nO } = readVarint(paramBytes, pOffset);
          otp.name = new TextDecoder().decode(paramBytes.subarray(nO, nO + nLen));
          pOffset = nO + nLen;
        } else if (pField === 3 && pWire === 2) { // Issuer
          let { value: iLen, newOffset: iO } = readVarint(paramBytes, pOffset);
          otp.issuer = new TextDecoder().decode(paramBytes.subarray(iO, iO + iLen));
          pOffset = iO + iLen;
        } else {
          if (pWire === 0) pOffset = readVarint(paramBytes, pOffset).newOffset;
          else if (pWire === 2) {
            let { value: skipLen, newOffset: skipO } = readVarint(paramBytes, pOffset);
            pOffset = skipO + skipLen;
          }
        }
      }
      if (otp.secret) accounts.push(otp);
    } else {
      if (wireType === 0) offset = readVarint(data, offset).newOffset;
      else if (wireType === 2) {
        let { value: skipLen, newOffset: skipO } = readVarint(data, offset);
        offset = skipO + skipLen;
      }
    }
  }
  return accounts;
}

// Convert byte array to standard Base32 string
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

// --- 2. HMAC-SHA1 Offline TOTP Algorithm ---
async function generateTOTP(base32Secret) {
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

  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30);

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, timeStep, false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', bytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, buffer);
  const hmac = new Uint8Array(signature);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt = ((hmac[offset] & 0x7f) << 24) |
                  ((hmac[offset + 1] & 0xff) << 16) |
                  ((hmac[offset + 2] & 0xff) << 8) |
                  (hmac[offset + 3] & 0xff);

  return (codeInt % 1000000).toString().padStart(6, '0');
}

// --- 3. Link Parser & Storage Handler ---
function processMigrationUrlString(urlString) {
  try {
    const urlClean = urlString.trim();
    if (!urlClean.includes('data=')) {
      throw new Error("Invalid link format. Ensure it contains 'data='.");
    }

    const urlParams = new URLSearchParams(urlClean.split('?')[1]);
    const dataB64 = urlParams.get('data').replace(/ /g, '+');

    const rawBytes = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0));
    const parsedAccounts = parseProtobuf(rawBytes);

    if (parsedAccounts.length === 0) {
      throw new Error("No accounts found in the provided link.");
    }

    const newAccounts = parsedAccounts.map(acc => ({
      name: acc.name,
      issuer: acc.issuer,
      secret: bytesToBase32(acc.secret)
    }));

    chrome.storage.local.get(['accounts'], (res) => {
      const current = res.accounts || [];
      const updated = [...current, ...newAccounts];
      chrome.storage.local.set({ accounts: updated }, () => {
        renderAccounts();
        const urlInputEl = document.getElementById('urlInput');
        if (urlInputEl) urlInputEl.value = ''; // Clear text input on success
      });
    });
  } catch (err) {
    alert("Error parsing link: " + (err.message || err));
  }
}

// --- 4. Event Listeners ---

// Handle Manual Link Submission (Pasted from ZXing)
const submitBtn = document.getElementById('submitUrlBtn');
if (submitBtn) {
  submitBtn.addEventListener('click', () => {
    const urlValue = document.getElementById('urlInput').value;
    if (!urlValue) {
      alert("Please paste an otpauth-migration link first.");
      return;
    }
    processMigrationUrlString(urlValue);
  });
}

// Handle Local QR File Upload
document.getElementById('qrInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    const img = new Image();
    img.src = event.target.result;
    img.onload = async () => {
      try {
        img.width = img.naturalWidth;
        img.height = img.naturalHeight;

        const codeReader = new ZXing.BrowserQRCodeReader();
        const result = await codeReader.decodeFromImageElement(img);

        if (!result || !result.text) {
          throw new Error("No QR code detected in image.");
        }

        processMigrationUrlString(result.text);
      } catch (err) {
        alert("Could not read QR code. Ensure the image is clear or try pasting the raw link instead.");
      }
    };
  };
  reader.readAsDataURL(file);
});

// --- 5. UI Rendering ---
async function renderAccounts() {
  chrome.storage.local.get(['accounts'], async (res) => {
    const listDiv = document.getElementById('accountList');
    listDiv.innerHTML = '';
    const accounts = res.accounts || [];

    if (accounts.length === 0) {
      listDiv.innerHTML = '<p style="font-size: 12px; color: #666;">No accounts added yet.</p>';
      return;
    }

    const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);

    accounts.forEach(async (acc, index) => {
      const code = await generateTOTP(acc.secret);
      const card = document.createElement('div');
      card.className = 'account-card';

      card.innerHTML = `
        <div class="card-header">
          <div class="account-name">${acc.issuer ? acc.issuer + ' (' + acc.name + ')' : acc.name}</div>
          <button class="delete-btn" title="Delete Account">&times;</button>
        </div>
        <div class="totp-code" title="Click to copy">${code}</div>
        <div class="timer">Refreshes in ${secondsLeft}s <span class="copy-status" style="margin-left:5px; color:#34a853; font-weight:bold;"></span></div>
      `;

      // Copy code on click
      const codeEl = card.querySelector('.totp-code');
      codeEl.addEventListener('click', () => {
        navigator.clipboard.writeText(code).then(() => {
          const statusSpan = card.querySelector('.copy-status');
          statusSpan.innerText = 'Copied!';
          setTimeout(() => { statusSpan.innerText = ''; }, 1500);
        });
      });

      // Delete account on 'x' click
      const deleteBtn = card.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete "${acc.name}"?`)) {
          deleteAccount(index);
        }
      });

      listDiv.appendChild(card);
    });
  });
}

// Function to remove selected item from storage
function deleteAccount(index) {
  chrome.storage.local.get(['accounts'], (res) => {
    const accounts = res.accounts || [];
    accounts.splice(index, 1);
    chrome.storage.local.set({ accounts: accounts }, () => {
      renderAccounts();
    });
  });
}

// Initial render and live ticker refresh every 1 second
renderAccounts();
setInterval(renderAccounts, 1000);