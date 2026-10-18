import QRCode from 'qrcode';
import { writeFile } from 'node:fs/promises';

// Encode the stable website URL, never a per-release CDN URL or a credential.
const svg = await QRCode.toString('https://ice-infinite.github.io/', {
  type:'svg', errorCorrectionLevel:'M', margin:2,
  color:{dark:'#174f40',light:'#ffffff'},
});
await writeFile(new URL('../assets/download-qr.svg', import.meta.url), svg);
