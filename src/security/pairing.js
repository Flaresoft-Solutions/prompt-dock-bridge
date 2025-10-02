import crypto from 'crypto';
import { getPublicKey, hashData } from './crypto.js';
import { logger } from '../utils/logger.js';

const pairingCodes = new Map();
const EXPIRY_TIME = 5 * 60 * 1000; // 5 minutes

export async function generatePairingCode(appName, appUrl) {
  cleanupExpiredCodes();

  const segments = [];
  for (let i = 0; i < 3; i++) {
    const segment = crypto.randomBytes(2).toString('hex').toUpperCase();
    segments.push(segment);
  }
  const code = segments.join('-');

  const pairingData = {
    code,
    appName,
    appUrl,
    bridgePublicKey: getPublicKey(),
    createdAt: Date.now(),
    expiresAt: Date.now() + EXPIRY_TIME,
    used: false
  };

  pairingCodes.set(code, pairingData);

  logger.info(`Generated pairing code ${code} for ${appName}`);

  setTimeout(() => {
    if (pairingCodes.has(code)) {
      pairingCodes.delete(code);
      logger.verbose(`Pairing code ${code} expired`);
    }
  }, EXPIRY_TIME);

  return pairingData;
}

export async function validatePairingCode(code, clientPublicKey) {
  cleanupExpiredCodes();

  const pairingData = pairingCodes.get(code);

  if (!pairingData) {
    logger.warn(`Invalid pairing code attempted: ${code}`);
    return null;
  }

  if (pairingData.used) {
    logger.warn(`Already used pairing code attempted: ${code}`);
    pairingCodes.delete(code);
    return null;
  }

  if (Date.now() > pairingData.expiresAt) {
    logger.warn(`Expired pairing code attempted: ${code}`);
    pairingCodes.delete(code);
    return null;
  }

  if (!clientPublicKey) {
    logger.warn(`Pairing attempt missing client public key for code: ${code}`);
    return null;
  }

  pairingData.used = true;
  pairingCodes.delete(code);

  logger.info(`Pairing code ${code} validated for ${pairingData.appName}`);
  logger.info(`Storing client public key: ${clientPublicKey.substring(0, 50)}...`);

  return {
    appName: pairingData.appName,
    appUrl: pairingData.appUrl,
    clientPublicKey,
    bridgePublicKey: pairingData.bridgePublicKey
  };
}

function cleanupExpiredCodes() {
  const now = Date.now();
  for (const [code, data] of pairingCodes.entries()) {
    if (now > data.expiresAt) {
      pairingCodes.delete(code);
      logger.verbose(`Cleaned up expired pairing code: ${code}`);
    }
  }
}

export function getPairingCodesStatus() {
  cleanupExpiredCodes();
  return {
    active: pairingCodes.size,
    codes: Array.from(pairingCodes.entries()).map(([code, data]) => ({
      code,
      appName: data.appName,
      expiresIn: Math.max(0, data.expiresAt - Date.now()),
      used: data.used
    }))
  };
}
