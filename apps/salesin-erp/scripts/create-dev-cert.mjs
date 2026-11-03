import { mkdir, access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import selfsigned from 'selfsigned';

const certificateDirectory = fileURLToPath(new URL('../ssl/', import.meta.url));
const certificatePath = path.join(certificateDirectory, 'localhost.pem');
const privateKeyPath = path.join(certificateDirectory, 'localhost-key.pem');
const certificateDerPath = path.join(certificateDirectory, 'localhost.cer');
const force = process.argv.includes('--force');

if (!force) {
  try {
    await Promise.all([access(certificatePath), access(privateKeyPath)]);
    console.log('Using existing localhost development certificate.');
    process.exit(0);
  } catch {
    // Generate a new certificate when either file is missing.
  }
}

await mkdir(certificateDirectory, { recursive: true });

const notAfterDate = new Date();
notAfterDate.setFullYear(notAfterDate.getFullYear() + 2);

const { cert, private: privateKey } = await selfsigned.generate(
  [{ name: 'commonName', value: 'localhost' }],
  {
    algorithm: 'sha256',
    keySize: 2048,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
    ],
  },
);
const certificateDer = Buffer.from(
  cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''),
  'base64',
);

await Promise.all([
  writeFile(certificatePath, cert, 'utf8'),
  writeFile(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 }),
  writeFile(certificateDerPath, certificateDer),
]);

console.log('Generated localhost certificate files in ssl/.');