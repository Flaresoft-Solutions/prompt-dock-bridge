import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const KEYS_DIR = path.join(os.homedir(), '.prompt-dock', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

let privateKey = null;
let publicKey = null;

export async function initializeSecurity() {
  try {
    await fs.mkdir(KEYS_DIR, { recursive: true, mode: 0o700 });

    try {
      privateKey = await fs.readFile(PRIVATE_KEY_PATH, 'utf-8');
      publicKey = await fs.readFile(PUBLIC_KEY_PATH, 'utf-8');
      await fs.chmod(PRIVATE_KEY_PATH, 0o600).catch(() => {});
      await fs.chmod(PUBLIC_KEY_PATH, 0o600).catch(() => {});
      logger.info('Loaded existing RSA keys');
    } catch (error) {
      logger.info('Generating new RSA key pair...');
      await generateKeyPair();
    }
  } catch (error) {
    logger.error('Failed to initialize security:', error);
    throw error;
  }
}

async function generateKeyPair() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    }, async (err, publicKeyGen, privateKeyGen) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        await fs.writeFile(PRIVATE_KEY_PATH, privateKeyGen, { mode: 0o600 });
        await fs.writeFile(PUBLIC_KEY_PATH, publicKeyGen, { mode: 0o600 });

        privateKey = privateKeyGen;
        publicKey = publicKeyGen;

        logger.info('RSA key pair generated and saved');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function signData(data) {
  if (!privateKey) {
    throw new Error('Private key not initialized');
  }

  const sign = crypto.createSign('SHA256');
  sign.write(data);
  sign.end();
  return sign.sign(privateKey, 'base64');
}

export function verifySignature(data, signature, publicKeyToUse = publicKey) {
  if (!publicKeyToUse) {
    throw new Error('Public key not provided');
  }

  try {
    const verify = crypto.createVerify('SHA256');
    verify.write(data);
    verify.end();
    return verify.verify(publicKeyToUse, signature, 'base64');
  } catch (error) {
    logger.error('Signature verification failed:', error);
    return false;
  }
}

export function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function generateRandomToken(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

export function getPublicKey() {
  return publicKey;
}

export function serializeForSignature(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('Invalid message for signature serialization');
  }

  const canonical = {
    type: message.type,
    timestamp: message.timestamp,
    nonce: message.nonce || null,
    data: canonicalize(message.data || {})
  };

  return JSON.stringify(canonical);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    return sortedKeys.reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }

  return value;
}

export function encryptData(data, key) {
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key, 'hex'), iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

export function decryptData(encryptedData, key) {
  const algorithm = 'aes-256-gcm';
  const decipher = crypto.createDecipheriv(
    algorithm,
    Buffer.from(key, 'hex'),
    Buffer.from(encryptedData.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
