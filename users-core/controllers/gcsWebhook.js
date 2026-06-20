const prisma = require("../../config/prisma");
const asyncHandler = require("express-async-handler");
const { parseGCSMetadata } = require("../../middlewares/gcsWebhookAuth");
const { deleteFile } = require("../../config/googleCloudStorage");

/**
 * @desc    Handle GCS webhook for profile uploads (avatars, general files)
 * @route   POST /api/user/gcs/webhook
 * @access  Public (with GCS webhook authentication)
 */
exports.handleGCSWebhook = asyncHandler(async (req, res) => {
  try {
    // GCS Object Change Notification structure
    const notification = req.body;

    // Extract file information
    const fileName = notification.name; // e.g., "users/avatars/userId_timestamp.jpg"
    const bucketName = notification.bucket;
    const eventType = notification.eventType || notification.kind; // e.g., "OBJECT_FINALIZE"

    // Only process finalize events (upload complete)
    if (eventType !== "OBJECT_FINALIZE" && eventType !== "storage#object") {
      return res
        .status(200)
        .json({ status: "ignored", reason: "not_finalize_event" });
    }

    // Parse metadata
    const metadata = parseGCSMetadata(notification);
    const { userId, uploadType } = metadata;

    if (!userId || !uploadType) {
      console.warn("[GCS_WEBHOOK] Missing metadata, cleaning up file", {
        fileName,
      });
      try {
        await deleteFile(fileName);
      } catch (cleanupErr) {
        console.error("[GCS_WEBHOOK] Cleanup failed:", cleanupErr);
      }
      return res
        .status(200)
        .json({ status: "ignored", reason: "missing_metadata" });
    }

    // Validate upload type
    const validTypes = ["avatar", "document"];
    if (!validTypes.includes(uploadType)) {
      console.error("[GCS_WEBHOOK] Invalid upload type", {
        fileName,
        uploadType,
      });
      try {
        await deleteFile(fileName);
      } catch (cleanupErr) {
        console.error("[GCS_WEBHOOK] Cleanup failed:", cleanupErr);
      }
      return res
        .status(200)
        .json({ status: "ignored", reason: "invalid_upload_type" });
    }

    // Find user by ID (UUID expected)
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.error("[GCS_WEBHOOK] User not found, cleaning up", {
        userId,
        fileName,
      });
      try {
        await deleteFile(fileName);
      } catch (cleanupErr) {
        console.error("[GCS_WEBHOOK] Cleanup failed:", cleanupErr);
      }
      return res
        .status(200)
        .json({ status: "ignored", reason: "user_not_found" });
    }

    // Generate public URL for the file
    const fileUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;

    // Sync: Update user or KYC directly
    if (uploadType === "avatar") {
      await prisma.user.update({
        where: { id: userId },
        data: {
          avatar: fileUrl,
          personalPhoto: { push: fileUrl }, // Pushing to personalPhoto array
        },
      });
    } else if (uploadType === "document") {
      // documentPhoto is inside UserKYC related model
      await prisma.userKYC.update({
        where: { userId: userId }, // unique relation
        data: {
          documentPhoto: fileUrl,
        },
      });
    }

    console.log(
      `[GCS_WEBHOOK] Successfully updated metadata for user ${userId}`,
    );

    res.status(200).json({
      status: "success",
      message: "Upload processed successfully",
    });
  } catch (error) {
    console.error("[GCS_WEBHOOK] Error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});
