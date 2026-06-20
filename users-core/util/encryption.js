const crypto = require("crypto");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ENCRYPTION_ALGORITHM = "aes-256-cbc";

if (!ENCRYPTION_KEY) {
  console.error(
    "ENCRYPTION_KEY not set in environment. Using default (development only)",
  );
}

/**
 * @param {any} data - Data to encrypt (string or object)
 * @returns {string} - Encrypted data in format: iv:encryptedData
 *
 * SMART: Automatically handles both:
 * - JWT strings (no JSON.stringify)
 * - Objects (with JSON.stringify)
 */
const encrypt = (data) => {
  try {
    const key = crypto.scryptSync(ENCRYPTION_KEY || "dev-secret", "salt", 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

    // ✅ Smart: If data is string (JWT), use as-is. If object, stringify it.
    const dataToEncrypt =
      typeof data === "string" ? data : JSON.stringify(data);

    let encrypted = cipher.update(dataToEncrypt, "utf8", "hex");
    encrypted += cipher.final("hex");

    const result = iv.toString("hex") + ":" + encrypted;
    return result;
  } catch (error) {
    console.error("Encryption error:", error.message);
    throw new Error("Failed to encrypt data");
  }
};

/**
 * @param {string} encryptedData - Encrypted data in format: iv:encryptedData
 * @returns {any} - Decrypted data (string or parsed object)
 *
 * SMART: Automatically handles both:
 * - JWT strings (returns raw string)
 * - JSON objects (returns parsed object)
 */
const decrypt = (encryptedData) => {
  try {
    const key = crypto.scryptSync(ENCRYPTION_KEY || "dev-secret", "salt", 32);

    const parts = encryptedData.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    // ✅ Smart: Try to parse as JSON. If it fails (JWT string), return raw string
    try {
      return JSON.parse(decrypted);
    } catch (parseError) {
      // Not JSON (probably JWT string), return as-is
      return decrypted;
    }
  } catch (error) {
    console.error("Decryption error:", error.message);
    throw new Error("Failed to decrypt data");
  }
};

/**
 * @param {Array} coordinates - [longitude, latitude]
 * @returns {string} - Encrypted coordinates
 */
const encryptCoordinates = (coordinates) => {
  return encrypt({ coordinates, type: "Point" });
};

/**
 * @param {string} encryptedCoords - Encrypted coordinates
 * @returns {Array} - [longitude, latitude]
 */
const decryptCoordinates = (encryptedCoords) => {
  const data = decrypt(encryptedCoords);
  return data.coordinates;
};

// ============================================================================
// TOKEN CACHING (Redis Removed)
// ============================================================================

/**
 * Cache decrypted token (No-op after Redis removal)
 * @param {string} tokenHash - Hash of encrypted token (cache key)
 * @param {Object} decodedToken - Decoded JWT claims
 * @param {number} ttl - Time to live in seconds
 */
const cacheToken = (tokenHash, decodedToken, ttl = 604800) => {
  // Redis removed, caching disabled
  return;
};

/**
 * Get cached token (Directly calls fallback after Redis removal)
 * Falls back to DB if not in Redis
 * @param {string} tokenHash - Hash of encrypted token
 * @param {Function} fallbackFn - Function to call if not in cache (DB query)
 * @returns {Promise} - Decoded token or null
 */
const getFromCacheOrDB = async (tokenHash, fallbackFn) => {
  // Redis removed, always use DB/Fallback
  return fallbackFn();
};

/**
 * Clear cached token (No-op after Redis removal)
 * Called when token is revoked/invalidated
 * @param {string} tokenHash - Hash of encrypted token
 */
const clearTokenCache = (tokenHash) => {
  // Redis removed, caching disabled
  return;
};

module.exports = {
  encrypt,
  decrypt,
  encryptCoordinates,
  decryptCoordinates,
  cacheToken,
  getFromCacheOrDB,
  clearTokenCache,
};
