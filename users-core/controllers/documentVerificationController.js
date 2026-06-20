const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const { parseGCSMetadata } = require("../../middlewares/gcsWebhookAuth");
const countries = require("../../models/users-core/countries.json");
const { deleteFile, uploadBuffer } = require("../../config/googleCloudStorage");
const {
  generateTokenAndSend,
} = require("../../middlewares/genarattokenandcookies");
const {
  RekognitionClient,
  DetectFacesCommand,
  CompareFacesCommand,
  DetectModerationLabelsCommand,
} = require("@aws-sdk/client-rekognition");
const { GoogleAuth } = require("google-auth-library");
const vision = require("@google-cloud/vision");
const sharp = require("sharp");
const prisma = require("../../config/prisma");

const rekognition = new RekognitionClient({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_VISION_CREDENTIALS || "{}"),
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const visionClient = new vision.ImageAnnotatorClient({ auth });

async function fetchImageBuffer(imageUrl) {
  if (!imageUrl) return null;
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Scan image for inappropriate content using Google Vision SafeSearch
 */
async function scanImageContentSafety(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const request = {
      image: { content: buffer.toString("base64") },
      features: [{ type: "SAFE_SEARCH_DETECTION" }],
    };

    const [result] = await visionClient.annotateImage(request);
    const safeSearch = result.safeSearchAnnotation;

    if (!safeSearch) {
      return { safe: true, reason: "No SafeSearch data" };
    }

    const harmfulLevels = ["LIKELY", "VERY_LIKELY"];
    const issues = [];

    if (harmfulLevels.includes(safeSearch.adult)) issues.push("Adult content");
    if (harmfulLevels.includes(safeSearch.violence)) issues.push("Violence");
    if (harmfulLevels.includes(safeSearch.racy)) issues.push("Racy content");

    if (issues.length > 0) {
      return {
        safe: false,
        reason: `Inappropriate content detected: ${issues.join(", ")}`,
        safeSearch,
      };
    }

    return { safe: true, safeSearch };
  } catch (error) {
    console.error("[CONTENT_SAFETY] Error:", error.message);
    return { safe: true, reason: `Scan warning: ${error.message}` };
  }
}

/**
 * Compress image using Sharp to save storage
 */
async function compressImage(imageInput, options = {}) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);

    const {
      quality = 85,
      maxWidth = 1920,
      maxHeight = 1920,
      format = "webp",
    } = options;

    const metadata = await sharp(buffer).metadata();

    if (buffer.length < 100 * 1024) {
      return {
        compressed: buffer,
        originalSize: buffer.length,
        compressedSize: buffer.length,
        compressionRatio: 1,
        skipped: true,
      };
    }

    let pipeline = sharp(buffer);

    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const compressed = await pipeline.webp({ quality }).toBuffer();
    const compressionRatio = (1 - compressed.length / buffer.length) * 100;

    return {
      compressed,
      originalSize: buffer.length,
      compressedSize: compressed.length,
      compressionRatio,
      format,
      skipped: false,
    };
  } catch (error) {
    console.error("[COMPRESS_IMAGE] Error:", error.message);
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    return {
      compressed: buffer,
      originalSize: buffer.length,
      compressedSize: buffer.length,
      compressionRatio: 0,
      error: error.message,
    };
  }
}

/**
 * Validate certificate expiry
 */
async function validateCertificateExpiry(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const request = {
      image: { content: buffer.toString("base64") },
      features: [{ type: "TEXT_DETECTION" }],
    };

    const [result] = await visionClient.annotateImage(request);
    const text = result.fullTextAnnotation?.text || "";

    const datePatterns = [
      /(?:valid|expires?|expiry|until|thru|to)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/gi,
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/g,
      /(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/g,
    ];

    let latestDate = null;

    for (const pattern of datePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const dateStr = match[1] || match[0];
        const parsed = new Date(dateStr.replace(/[\/\.]/g, "-"));
        if (!isNaN(parsed.getTime())) {
          if (!latestDate || parsed > latestDate) {
            latestDate = parsed;
          }
        }
      }
    }

    if (!latestDate) {
      return {
        valid: true,
        expiryDate: null,
        needsManualReview: true,
        reason: "No expiry date found",
      };
    }

    const now = new Date();
    const isExpired = latestDate < now;
    const daysUntilExpiry = Math.ceil(
      (latestDate - now) / (1000 * 60 * 60 * 24),
    );

    if (isExpired) {
      return {
        valid: false,
        expiryDate: latestDate,
        reason: `Document expired on ${latestDate.toISOString().split("T")[0]}`,
      };
    }

    return {
      valid: true,
      expiryDate: latestDate,
      daysUntilExpiry,
      needsManualReview: false,
    };
  } catch (error) {
    console.error("[CERTIFICATE_EXPIRY] Error:", error.message);
    return {
      valid: true,
      expiryDate: null,
      needsManualReview: true,
      reason: `Expiry check failed: ${error.message}`,
    };
  }
}

/**
 * Validate image integrity
 */
async function validateImageIntegrity(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const metadata = await sharp(buffer).metadata();
    const allowedFormats = ["jpeg", "jpg", "png", "webp", "gif"];
    if (!allowedFormats.includes(metadata.format)) {
      return {
        valid: false,
        reason: `Invalid format: ${metadata.format}. Allowed: ${allowedFormats.join(", ")}`,
      };
    }
    if (metadata.width < 300 || metadata.height < 300) {
      return {
        valid: false,
        reason: "Image too small. Minimum 300x300 pixels required",
      };
    }
    if (buffer.length > 10 * 1024 * 1024) {
      return { valid: false, reason: "File too large. Maximum 10MB allowed" };
    }
    return {
      valid: true,
      metadata: {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        size: buffer.length,
      },
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Image validation failed: ${error.message}`,
    };
  }
}

async function detectFaceInImage(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const command = new DetectFacesCommand({
      Image: { Bytes: buffer },
      Attributes: ["ALL"],
    });
    const result = await rekognition.send(command);
    if (!result.FaceDetails?.length)
      return { valid: false, reason: "No face detected" };
    const face = result.FaceDetails[0];
    const confidence = face.Confidence || 0;
    const eyesOpen = face.EyesOpen?.Value || false;
    if (confidence < 80)
      return {
        valid: false,
        reason: `Low face confidence: ${confidence.toFixed(2)}%`,
      };
    if (!eyesOpen) return { valid: false, reason: "Eyes must be open" };
    return { valid: true, qualityScore: confidence, faceDetails: face };
  } catch (error) {
    return { valid: false, reason: `Face detection error: ${error.message}` };
  }
}

async function checkFaceLiveness(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const modCmd = new DetectModerationLabelsCommand({
      Image: { Bytes: buffer },
      MinConfidence: 60,
    });
    const modRes = await rekognition.send(modCmd);
    const spoofIndicators = [
      "Screen",
      "Monitor",
      "Display",
      "Printed",
      "Photo",
      "Picture",
      "Mask",
    ];
    const isSpoof = modRes.ModerationLabels?.some((l) =>
      spoofIndicators.some((i) =>
        l.Name?.toLowerCase().includes(i.toLowerCase()),
      ),
    );
    if (isSpoof)
      return {
        valid: false,
        reason: "Spoofing detected",
        livenessScore: 0,
        spoofingDetected: true,
      };
    const faceCmd = new DetectFacesCommand({
      Image: { Bytes: buffer },
      Attributes: ["ALL"],
    });
    const faceRes = await rekognition.send(faceCmd);
    if (!faceRes.FaceDetails?.length)
      return {
        valid: false,
        reason: "No face found",
        livenessScore: 0,
        spoofingDetected: false,
      };

    const face = faceRes.FaceDetails[0];
    let livenessScore = 0;
    if (face.Confidence > 95) livenessScore += 30;
    else if (face.Confidence > 85) livenessScore += 20;
    if (face.EyesOpen?.Value && face.EyesOpen?.Confidence > 90)
      livenessScore += 20;
    const { Pitch, Roll, Yaw } = face.Pose || {};
    const isFacingForward =
      Math.abs(Pitch || 0) < 15 &&
      Math.abs(Roll || 0) < 15 &&
      Math.abs(Yaw || 0) < 15;
    if (isFacingForward) livenessScore += 25;
    else
      return {
        valid: false,
        reason: "Face must be looking directly at camera",
        livenessScore: 0,
      };
    if (face.Quality?.Brightness >= 40 && face.Quality?.Brightness <= 95)
      livenessScore += 15;
    if (face.Quality?.Sharpness > 70) livenessScore += 10;
    if (face.Smile?.Value) livenessScore += 5;

    if (livenessScore < 85) {
      return {
        valid: false,
        reason: `Liveness score too low (${livenessScore})`,
        livenessScore,
        spoofingDetected: false,
        livenessConfidence: face.Confidence,
      };
    }
    return {
      valid: true,
      livenessScore,
      spoofingDetected: false,
      livenessConfidence: face.Confidence,
      pose: face.Pose,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Liveness error: ${error.message}`,
      livenessScore: 0,
      spoofingDetected: false,
    };
  }
}

async function detectImageManipulation(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const metadata = await sharp(buffer).metadata();
    let score = 0;
    let indicators = [];
    const software = [
      "photoshop",
      "gimp",
      "paint.net",
      "pixlr",
      "canva",
      "adobe",
    ];
    if (metadata.exif) {
      const exif = JSON.stringify(metadata.exif).toLowerCase();
      const found = software.find((s) => exif.includes(s));
      if (found) {
        score += 40;
        indicators.push(`Software detected: ${found}`);
      }
    }
    if (!metadata.exif || Object.keys(metadata.exif).length < 3) {
      score += 20;
      indicators.push("Missing EXIF");
    }
    const visionReq = {
      image: { content: buffer.toString("base64") },
      features: [{ type: "IMAGE_PROPERTIES" }],
    };
    const [visionRes] = await visionClient.annotateImage(visionReq);
    const colors =
      visionRes.imagePropertiesAnnotation?.dominantColors?.colors?.slice(0, 5);
    if (
      colors?.some(
        (c) =>
          Math.max(c.color.red || 0, c.color.blue || 0, c.color.green || 0) -
            Math.min(c.color.red || 0, c.color.blue || 0, c.color.green || 0) >
          200,
      )
    ) {
      score += 15;
      indicators.push("Unnatural saturation");
    }
    if (metadata.density && metadata.density < 72) {
      score += 10;
      indicators.push("Low density");
    }
    return {
      valid: score < 40,
      reason:
        score >= 40 ? `Manipulation likely: ${indicators.join(", ")}` : "Clean",
      manipulationScore: score,
      indicators,
    };
  } catch (error) {
    return {
      valid: true,
      reason: `Check warning: ${error.message}`,
      manipulationScore: 0,
      indicators: [],
    };
  }
}

async function extractTextFromDocument(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const request = {
      image: { content: buffer.toString("base64") },
      features: [
        { type: "TEXT_DETECTION" },
        { type: "DOCUMENT_TEXT_DETECTION" },
      ],
    };
    const [result] = await visionClient.annotateImage(request);
    const text = result.fullTextAnnotation?.text;
    if (!text || text.length < 20)
      return { valid: false, reason: "Text unclear or too sparse" };
    const docMarkers = [
      "identity",
      "card",
      "passport",
      "national",
      "republic",
      "بطاقة",
      "القومي",
      "شخصية",
      "جواز",
      "سفر",
    ];
    const hasMarker = docMarkers.some((m) => text.toLowerCase().includes(m));
    if (!hasMarker && text.length < 50)
      return { valid: false, reason: "Document structure not recognized" };
    return { valid: true, extractedText: text };
  } catch (error) {
    return { valid: false, reason: `OCR error: ${error.message}` };
  }
}

async function compareFacesFromUrls(img1, img2) {
  try {
    const buf1 = Buffer.isBuffer(img1) ? img1 : await fetchImageBuffer(img1);
    const buf2 = Buffer.isBuffer(img2) ? img2 : await fetchImageBuffer(img2);
    const command = new CompareFacesCommand({
      SourceImage: { Bytes: buf1 },
      TargetImage: { Bytes: buf2 },
      SimilarityThreshold: 0,
    });
    const result = await rekognition.send(command);
    if (!result.FaceMatches?.length)
      return { success: false, reason: "No match", similarity: 0 };
    return { success: true, similarity: result.FaceMatches[0].Similarity || 0 };
  } catch (error) {
    return {
      success: false,
      reason: `Comparison error: ${error.message}`,
      similarity: 0,
    };
  }
}

async function verifyMedicalProviderDocument(imageInput) {
  try {
    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);
    const request = {
      image: { content: buffer.toString("base64") },
      features: [{ type: "TEXT_DETECTION" }],
    };
    const [result] = await visionClient.annotateImage(request);
    const text = result.fullTextAnnotation?.text?.toLowerCase();
    if (!text) return { valid: false, reason: "Unreadable text" };
    const keywords = [
      "doctor",
      "nursing",
      "nurse",
      "pharmacy",
      "hospital",
      "medical",
      "license",
      "certificate",
      "degree",
      "health",
    ];
    if (!keywords.some((k) => text.includes(k)))
      return { valid: false, reason: "Not a recognized medical document" };
    return { valid: true, extractedText: result.fullTextAnnotation.text };
  } catch (error) {
    return { valid: false, reason: `Guide error: ${error.message}` };
  }
}

function validateInternationalIdFormat(extractedText, country = "any") {
  const isValidCountry =
    country !== "any" && Object.keys(countries).includes(country);
  const patterns = {
    Egypt: {
      regex: /\b([23])(\d{2})(\d{2})(\d{2})\d{7}\b/,
      type: "national_id",
      validator: (match) => {
        if (/^(\d)\1+$/.test(match[0])) return { valid: false };
        const year = (match[1] === "2" ? 1900 : 2000) + parseInt(match[2]);
        const month = parseInt(match[3]);
        const day = parseInt(match[4]);
        return month >= 1 && month <= 12 && day >= 1 && day <= 31
          ? { valid: true, dateOfBirth: new Date(year, month - 1, day) }
          : { valid: false };
      },
    },
    "Saudi Arabia": {
      regex: /\b[12]\d{9}\b/,
      type: "national_id",
      validator: () => ({ valid: true }),
    },
    "United Arab Emirates": {
      regex: /\b784-\d{4}-\d{7}-\d\b/,
      type: "national_id",
      validator: () => ({ valid: true }),
    },
    "United States": {
      regex: /\b\d{3}-\d{2}-\d{4}\b/,
      type: "national_id",
      validator: () => ({ valid: true }),
    },
    "United Kingdom": {
      regex: /\b[A-Z]{2}\d{6}[A-Z]\b/i,
      type: "national_id",
      validator: () => ({ valid: true }),
    },
    Passport: {
      regex: /\b[A-Z0-9]{6,9}\b/i,
      type: "passport",
      validator: () => ({ valid: true }),
    },
    Generic: {
      regex: /\b[A-Z0-9]{5,20}\b/i,
      type: "other",
      validator: () => ({ valid: true }),
    },
  };

  if (patterns[country]) {
    const match = extractedText.match(patterns[country].regex);
    if (match) {
      const result = patterns[country].validator(match);
      if (result.valid)
        return {
          valid: true,
          extractedId: match[0].toUpperCase(),
          idType: patterns[country].type,
          dateOfBirth: result.dateOfBirth || null,
        };
    }
  }

  const passportMatch = extractedText.match(patterns.Passport.regex);
  if (passportMatch)
    return {
      valid: true,
      extractedId: passportMatch[0].toUpperCase(),
      idType: "passport",
      dateOfBirth: null,
    };

  if (isValidCountry || country === "any") {
    const genericMatch = extractedText.match(patterns.Generic.regex);
    if (genericMatch)
      return {
        valid: true,
        extractedId: genericMatch[0].toUpperCase(),
        idType: "other",
        dateOfBirth: null,
      };
  }

  return { valid: false, reason: `No valid ID recognized for ${country}` };
}

async function checkDuplicateId(extractedId, currentUserId) {
  const existingKYC = await prisma.userKYC.findFirst({
    where: { identityNumber: extractedId, userId: { not: currentUserId } },
  });
  if (existingKYC)
    return { isDuplicate: true, reason: "ID is already registered" };
  return { isDuplicate: false };
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() < birthDate.getDate())
  )
    age--;
  return age;
}

function verifyAge(dateOfBirth, minimumAge = 18) {
  const age = calculateAge(dateOfBirth);
  if (age === null)
    return { valid: false, reason: "Could not determine age", age: null };
  if (age < minimumAge)
    return { valid: false, reason: `User must be at least ${minimumAge}`, age };
  return { valid: true, age };
}

function calculateRiskScore(verificationResults) {
  let score = 0;
  const factors = [];
  if (verificationResults.faceSimilarity < 70) {
    score += 50;
    factors.push("Very low face similarity");
  } else if (verificationResults.faceSimilarity < 80) {
    score += 30;
    factors.push("Low face similarity");
  } else if (verificationResults.faceSimilarity < 90) {
    score += 10;
    factors.push("Moderate face similarity");
  }

  if (verificationResults.livenessScore < 80) {
    score += 20;
    factors.push("Low liveness score");
  }
  if (verificationResults.spoofingDetected) {
    score += 40;
    factors.push("Spoofing indicators detected");
  }
  if (verificationResults.selfieManipulationScore >= 40) {
    score += 40;
    factors.push("Selfie manipulation detected");
  }
  if (verificationResults.idCardManipulationScore >= 40) {
    score += 40;
    factors.push("ID card manipulation detected");
  }

  if (verificationResults.isFirstVerification) {
    score += 5;
    factors.push("First attempt");
  }

  score = Math.min(score, 100);
  const level = score <= 30 ? "low" : score <= 60 ? "medium" : "high";
  return { score, level, factors };
}

async function checkRetryLimits(userKYC, prismaInstance) {
  const MAX_ATTEMPTS = 3;
  const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000;

  const attempts =
    userKYC.kycAttempts && typeof userKYC.kycAttempts === "object"
      ? userKYC.kycAttempts
      : { count: 0, lockedUntil: null };

  if (attempts.lockedUntil && new Date() < new Date(attempts.lockedUntil)) {
    const remainingMs = new Date(attempts.lockedUntil) - new Date();
    return {
      allowed: false,
      reason: `Too many failed attempts. Try in ${Math.ceil(remainingMs / 3600000)} hours.`,
    };
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    await prismaInstance.userKYC.update({
      where: { id: userKYC.id },
      data: {
        kycAttempts: {
          count: attempts.count,
          lastAttempt: new Date().toISOString(),
          lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString(),
        },
      },
    });
    return {
      allowed: false,
      reason: "Max attempts exceeded. Locked for 24 hours.",
    };
  }

  return { allowed: true };
}

async function incrementKycAttempts(userKYC, prismaInstance) {
  const count = (userKYC.kycAttempts?.count || 0) + 1;
  const lockedUntil = userKYC.kycAttempts?.lockedUntil || null;
  await prismaInstance.userKYC.update({
    where: { id: userKYC.id },
    data: {
      kycAttempts: {
        count,
        lastAttempt: new Date().toISOString(),
        lockedUntil,
      },
    },
  });
}

async function resetKycAttempts(userKYC, prismaInstance) {
  await prismaInstance.userKYC.update({
    where: { id: userKYC.id },
    data: { kycAttempts: { count: 0, lastAttempt: null, lockedUntil: null } },
  });
}

async function processDocumentVerification(userKYC) {
  const retryCheck = await checkRetryLimits(userKYC, prisma);
  if (!retryCheck.allowed) throw new Error(retryCheck.reason);

  const pendingDocs = userKYC.pendingDocuments || {};

  try {
    const [selfieBuf, idBuf, guideBuf] = await Promise.all([
      fetchImageBuffer(pendingDocs.selfie?.url),
      fetchImageBuffer(pendingDocs.idCard?.url),
      pendingDocs.medicalDocument?.url
        ? fetchImageBuffer(pendingDocs.medicalDocument.url)
        : null,
    ]);

    const [selfieIntegrity, idIntegrity, guideIntegrity] = await Promise.all([
      validateImageIntegrity(selfieBuf),
      validateImageIntegrity(idBuf),
      guideBuf ? validateImageIntegrity(guideBuf) : { valid: true },
    ]);
    if (!selfieIntegrity.valid)
      throw new Error(`Selfie Invalid: ${selfieIntegrity.reason}`);
    if (!idIntegrity.valid)
      throw new Error(`ID Invalid: ${idIntegrity.reason}`);
    if (guideBuf && !guideIntegrity.valid)
      throw new Error(`Medical Doc Invalid: ${guideIntegrity.reason}`);

    const [selfieScan, idScan, guideScan] = await Promise.all([
      scanImageContentSafety(selfieBuf),
      scanImageContentSafety(idBuf),
      guideBuf ? scanImageContentSafety(guideBuf) : { safe: true },
    ]);
    if (!selfieScan.safe) {
      await deleteFile(pendingDocs.selfie?.fileName).catch(() => {});
      throw new Error(`Selfie Rejected: ${selfieScan.reason}`);
    }
    if (!idScan.safe) {
      await deleteFile(pendingDocs.idCard?.fileName).catch(() => {});
      throw new Error(`ID Rejected: ${idScan.reason}`);
    }

    let certExpiryResult = { valid: true };
    if (guideBuf) {
      certExpiryResult = await validateCertificateExpiry(guideBuf);
      if (!certExpiryResult.valid)
        throw new Error(`Certificate Expiry: ${certExpiryResult.reason}`);
    }

    const [
      selfieRes,
      livenessRes,
      selfieManipRes,
      ocrRes,
      idManipRes,
      guideRes,
    ] = await Promise.all([
      detectFaceInImage(selfieBuf),
      checkFaceLiveness(selfieBuf),
      detectImageManipulation(selfieBuf),
      extractTextFromDocument(idBuf),
      detectImageManipulation(idBuf),
      guideBuf ? verifyMedicalProviderDocument(guideBuf) : { valid: true },
    ]);

    if (!selfieRes.valid) throw new Error(`Selfie: ${selfieRes.reason}`);
    if (!livenessRes.valid) throw new Error(`Liveness: ${livenessRes.reason}`);
    if (!ocrRes.valid) throw new Error(`OCR: ${ocrRes.reason}`);

    const userCore = await prisma.user.findUnique({
      where: { id: userKYC.userId },
    });
    const idValidation = validateInternationalIdFormat(
      ocrRes.extractedText,
      userCore?.country || "any",
    );
    if (!idValidation.valid)
      throw new Error(`ID Format Invalid: ${idValidation.reason}`);

    const [dupCheck, faceRes] = await Promise.all([
      checkDuplicateId(idValidation.extractedId, userKYC.userId),
      compareFacesFromUrls(selfieBuf, idBuf),
    ]);

    if (dupCheck.isDuplicate) throw new Error(dupCheck.reason);
    if (!faceRes.success || faceRes.similarity < 70)
      throw new Error("Face Match failed");

    const risk = calculateRiskScore({
      faceSimilarity: faceRes.similarity,
      livenessScore: livenessRes.livenessScore,
      spoofingDetected: livenessRes.spoofingDetected,
      selfieManipulationScore: selfieManipRes.manipulationScore,
      idCardManipulationScore: idManipRes.manipulationScore,
      isFirstVerification: !userKYC.documentation,
    });
    if (risk.level === "high")
      throw new Error(`High Risk Verification: ${risk.factors.join(", ")}`);

    const [selfieCompressed, idCompressed, guideCompressed] = await Promise.all(
      [
        compressImage(selfieBuf),
        compressImage(idBuf),
        guideBuf ? compressImage(guideBuf) : null,
      ],
    );

    const uploadTasks = [];
    const deleteTasks = [];
    const selfieFileName = `compressed_selfie_${userKYC.userId}_${Date.now()}.webp`;
    uploadTasks.push(
      uploadBuffer(selfieCompressed.compressed, selfieFileName, "image/webp"),
    );
    if (pendingDocs.selfie?.fileName)
      deleteTasks.push(deleteFile(pendingDocs.selfie.fileName).catch(() => {}));

    const idFileName = `compressed_id_${userKYC.userId}_${Date.now()}.webp`;
    uploadTasks.push(
      uploadBuffer(idCompressed.compressed, idFileName, "image/webp"),
    );
    if (pendingDocs.idCard?.fileName)
      deleteTasks.push(deleteFile(pendingDocs.idCard.fileName).catch(() => {}));

    let guideFileName = null;
    if (guideCompressed) {
      guideFileName = `compressed_medical_${userKYC.userId}_${Date.now()}.webp`;
      uploadTasks.push(
        uploadBuffer(guideCompressed.compressed, guideFileName, "image/webp"),
      );
      if (pendingDocs.medicalDocument?.fileName)
        deleteTasks.push(
          deleteFile(pendingDocs.medicalDocument.fileName).catch(() => {}),
        );
    }

    const [newSelfieUrl, newIdUrl, newGuideUrl] =
      await Promise.all(uploadTasks);
    await Promise.all(deleteTasks);

    await prisma.user.update({
      where: { id: userKYC.userId },
      data: {
        avatar: newSelfieUrl, // Updating avatar directly with the verified selfie
      },
    });

    const verificationData = {
      extractedText: ocrRes.extractedText,
      extractedId: idValidation.extractedId,
      faceSimilarity: faceRes.similarity,
      livenessScore: livenessRes.livenessScore,
    };

    const emptyPendingDocs = {
      selfie: { url: null, fileName: null },
      idCard: { url: null, fileName: null },
      medicalDocument: { url: null, fileName: null },
      verificationStatus: "completed",
    };

    await resetKycAttempts(userKYC, prisma);

    await prisma.userKYC.update({
      where: { id: userKYC.id },
      data: {
        documentPhoto: newIdUrl,
        medicalDocument: newGuideUrl || userKYC.medicalDocument,
        documentation: true,
        identityNumber: idValidation.extractedId,
        identityType: idValidation.idType,
        dateOfBirth: idValidation.dateOfBirth,
        age: idValidation.dateOfBirth
          ? calculateAge(idValidation.dateOfBirth)
          : null,
        idVerificationData: verificationData,
        riskScore: risk.score,
        riskLevel: risk.level,
        riskFactors: risk.factors,
        pendingDocuments: emptyPendingDocs,
      },
    });

    return true;
  } catch (error) {
    await incrementKycAttempts(userKYC, prisma);
    throw error;
  }
}

exports.gcsDocumentWebhook = asyncHandler(async (req, res) => {
  try {
    const notification = req.body;
    const fileName = notification.name;
    const eventType = notification.eventType || notification.kind;

    if (eventType !== "OBJECT_FINALIZE" && eventType !== "storage#object") {
      return res.status(200).json({ status: "ignored" });
    }

    const metadata = parseGCSMetadata(notification);
    const { userId, uploadType, sessionId } = metadata;

    if (!userId || !uploadType) {
      await deleteFile(fileName).catch(() => {});
      return res.status(200).json({ status: "ignored" });
    }

    let userKYC = await prisma.userKYC.findUnique({ where: { userId } });
    if (!userKYC) {
      userKYC = await prisma.userKYC.create({ data: { userId } });
    }

    if (userKYC.documentation === true) {
      await deleteFile(fileName).catch(() => {});
      return res.status(200).json({ status: "already_verified" });
    }

    let docs =
      userKYC.pendingDocuments && typeof userKYC.pendingDocuments === "object"
        ? userKYC.pendingDocuments
        : {};

    const fileUrl = `https://storage.googleapis.com/${notification.bucket}/${fileName}`;
    docs[uploadType] = {
      url: fileUrl,
      fileName,
      uploadedAt: new Date().toISOString(),
    };
    docs.sessionId = sessionId || crypto.randomUUID();

    const hasSelfie = !!docs.selfie?.url;
    const hasIdCard = !!docs.idCard?.url;

    if (hasSelfie && hasIdCard) docs.verificationStatus = "processing";

    // Perform update in database explicitly
    const updatedKYC = await prisma.userKYC.update({
      where: { id: userKYC.id },
      data: { pendingDocuments: docs },
    });

    if (hasSelfie && hasIdCard) {
      processDocumentVerification(updatedKYC).catch(async (e) => {
        console.error("Verification failed:", e.message);
        let freshKyc = await prisma.userKYC.findUnique({
          where: { id: updatedKYC.id },
        });
        let failedDocs = freshKyc.pendingDocuments || {};
        failedDocs.verificationStatus = "failed";
        await prisma.userKYC.update({
          where: { id: freshKyc.id },
          data: { pendingDocuments: failedDocs },
        });
      });
    }

    res.status(200).json({ status: "accepted" });
  } catch (error) {
    res.status(500).json({ error: "Webhook failed" });
  }
});

exports.getVerificationStatus = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { kyc: true },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const kycDocs =
      user.kyc?.pendingDocuments &&
      typeof user.kyc.pendingDocuments === "object"
        ? user.kyc.pendingDocuments
        : null;

    generateTokenAndSend(user, res, {
      documentationComplete: user.kyc?.documentation || false,
      pendingDocuments: kycDocs
        ? {
            selfie: !!kycDocs.selfie?.url,
            idCard: !!kycDocs.idCard?.url,
            status: kycDocs.verificationStatus,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

exports.processDocumentVerification = processDocumentVerification;
