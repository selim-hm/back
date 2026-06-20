const asyncHandler = require("express-async-handler");
const xss = require("xss");
const prisma = require("../../config/prisma");
const { parseGCSMetadata } = require("../../middlewares/gcsWebhookAuth");
const { deleteFile } = require("../../config/googleCloudStorage");

/**
 * @desc    Add a new academic degree to user's profile
 * @route   POST /api/user/academic-degrees
 * @access  Private
 */
exports.addAcademicDegree = asyncHandler(async (req, res) => {
  try {
    const { degree, field, institution, graduationYear } = req.body;
    const userId = req.user.id || req.user._id;

    // Validate required fields
    if (!degree || !field || !institution) {
      return res.status(400).json({
        message: "Degree type, field of study, and institution are required",
      });
    }

    // Validate degree type
    const validDegrees = [
      "bachelor",
      "master",
      "phd",
      "diploma",
      "associate",
      "other",
    ];
    if (!validDegrees.includes(degree)) {
      return res.status(400).json({
        message: `Invalid degree type. Must be one of: ${validDegrees.join(", ")}`,
      });
    }

    // Check if user exists and email is verified
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        message: "Email must be verified before adding academic degrees",
      });
    }

    // Add new academic degree
    const newDegree = await prisma.academicDegree.create({
      data: {
        userId: userId,
        degree: degree,
        field: xss(field),
        institution: xss(institution),
        graduationYear: graduationYear ? Number(graduationYear) : null,
      },
    });

    // Get all updated degrees for response consistency
    const allDegrees = await prisma.academicDegree.findMany({
      where: { userId },
    });

    console.log(`addAcademicDegree successfully ${userId}`);
    res.status(201).json({
      message: "Academic degree added successfully",
      academicDegree: newDegree,
      academicDegrees: allDegrees,
    });
  } catch (error) {
    console.error(`addAcademicDegree error:`, error);
    res.status(500).json({
      message: "Error adding academic degree",
      error: error.message,
    });
  }
});

/**
 * @desc    Get all academic degrees for user
 * @route   GET /api/user/academic-degrees
 * @access  Private
 */
exports.getAcademicDegrees = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const degrees = await prisma.academicDegree.findMany({
      where: { userId },
    });

    console.log(`getAcademicDegrees successfully ${userId}`);
    res.status(200).json({
      academicDegrees: degrees,
      count: degrees.length,
    });
  } catch (error) {
    console.error(`getAcademicDegrees error:`, error);
    res.status(500).json({
      message: "Error fetching academic degrees",
      error: error.message,
    });
  }
});

/**
 * @desc    Update an academic degree by ID
 * @route   PUT /api/user/academic-degrees/:degreeId
 * @access  Private
 */
exports.updateAcademicDegree = asyncHandler(async (req, res) => {
  try {
    const { degreeId } = req.params;
    const { degree, field, institution, graduationYear } = req.body;
    const userId = req.user.id || req.user._id;

    const academicDegree = await prisma.academicDegree.findUnique({
      where: { id: degreeId },
    });

    if (!academicDegree || academicDegree.userId !== userId) {
      return res.status(404).json({
        message: "Academic degree not found in your profile",
      });
    }

    let updateData = {};

    // Update degree type if provided
    if (degree) {
      const validDegrees = [
        "bachelor",
        "master",
        "phd",
        "diploma",
        "associate",
        "other",
      ];
      if (!validDegrees.includes(degree)) {
        return res.status(400).json({
          message: `Invalid degree type. Must be one of: ${validDegrees.join(", ")}`,
        });
      }
      updateData.degree = degree;
    }

    if (field) updateData.field = xss(field);
    if (institution) updateData.institution = xss(institution);
    if (graduationYear !== undefined)
      updateData.graduationYear = Number(graduationYear);

    const updatedDegree = await prisma.academicDegree.update({
      where: { id: degreeId },
      data: updateData,
    });

    const allDegrees = await prisma.academicDegree.findMany({
      where: { userId },
    });

    console.log(`updateAcademicDegree successfully ${userId}`);
    res.status(200).json({
      message: "Academic degree updated successfully",
      academicDegree: updatedDegree,
      academicDegrees: allDegrees,
    });
  } catch (error) {
    console.error(`updateAcademicDegree error:`, error);
    res.status(500).json({
      message: "Error updating academic degree",
      error: error.message,
    });
  }
});

/**
 * @desc    Delete an academic degree by ID
 * @route   DELETE /api/user/academic-degrees/:degreeId
 * @access  Private
 */
exports.deleteAcademicDegree = asyncHandler(async (req, res) => {
  try {
    const { degreeId } = req.params;
    const userId = req.user.id || req.user._id;

    const degreeToDelete = await prisma.academicDegree.findUnique({
      where: { id: degreeId },
    });

    if (!degreeToDelete || degreeToDelete.userId !== userId) {
      return res.status(404).json({
        message: "Academic degree not found in your profile",
      });
    }

    // Delete certificate image from GCS if exists
    if (degreeToDelete.certificateImage) {
      try {
        // Extract filename from URL
        const urlParts = degreeToDelete.certificateImage.split("/");
        const fileName = urlParts.slice(4).join("/"); // skip https://storage.googleapis.com/bucket/
        await deleteFile(fileName);
      } catch (e) {
        console.error("Failed to delete certificate image from GCS:", e);
      }
    }

    await prisma.academicDegree.delete({
      where: { id: degreeId },
    });

    const allDegrees = await prisma.academicDegree.findMany({
      where: { userId },
    });

    console.log(`deleteAcademicDegree successfully ${userId}`);
    res.status(200).json({
      message: "Academic degree deleted successfully",
      academicDegrees: allDegrees,
    });
  } catch (error) {
    console.error(`deleteAcademicDegree error:`, error);
    res.status(500).json({
      message: "Error deleting academic degree",
      error: error.message,
    });
  }
});

/**
 * @desc    Handle certificate image upload webhook from GCS
 * @route   POST /api/user/academic-degrees/webhook/image
 * @access  Public (with signature verification)
 */
exports.handleCertificateImageWebhook = asyncHandler(async (req, res) => {
  try {
    // GCS Object Change Notification structure
    const notification = req.body;
    const fileName = notification.name;
    const eventType = notification.eventType || notification.kind;

    // Only process finalize events
    if (eventType !== "OBJECT_FINALIZE" && eventType !== "storage#object") {
      return res.status(200).json({ status: "ignored" });
    }

    const metadata = parseGCSMetadata(notification);
    const userId = metadata.userId;
    const degreeId = metadata.degreeId;

    if (!userId || !degreeId) {
      // Cleanup invalid upload
      try {
        await deleteFile(fileName);
      } catch (e) {
        console.error("Failed to cleanup invalid certificate image:", e);
      }
      return res.status(200).json({ status: "ignored_missing_context" });
    }

    // Check user existence
    const userCount = await prisma.user.count({ where: { id: userId } });
    if (userCount === 0) {
      try {
        await deleteFile(fileName);
      } catch (e) {
        console.error("Failed to cleanup image for non-existent user:", e);
      }
      return res.status(200).json({ status: "ignored_user_not_found" });
    }

    // Find academic degree by ID
    const academicDegree = await prisma.academicDegree.findUnique({
      where: { id: degreeId },
    });

    if (!academicDegree || academicDegree.userId !== userId) {
      try {
        await deleteFile(fileName);
      } catch (e) {
        console.error("Failed to cleanup image for non-existent degree:", e);
      }
      return res.status(200).json({ status: "ignored_degree_not_found" });
    }

    // Validate: only image files allowed (no videos)
    const contentType = notification.contentType || "";
    const isImage = contentType.startsWith("image/");

    if (!isImage) {
      try {
        await deleteFile(fileName);
      } catch (e) {
        console.error("Failed to cleanup invalid file format:", e);
      }
      return res.status(200).json({
        status: "invalid_format",
        message: "Only image files are allowed for certificates",
      });
    }

    // Generate public URL
    const fileUrl = `https://storage.googleapis.com/${notification.bucket}/${fileName}`;

    // Delete old certificate image if exists
    if (academicDegree.certificateImage) {
      try {
        const oldUrlParts = academicDegree.certificateImage.split("/");
        const oldFileName = oldUrlParts.slice(4).join("/");
        await deleteFile(oldFileName);
      } catch (e) {
        console.error("Failed to delete old certificate image:", e);
      }
    }

    // Update degree with new certificate image URL
    const updatedDegree = await prisma.academicDegree.update({
      where: { id: degreeId },
      data: { certificateImage: fileUrl },
    });

    console.log(`handleCertificateImageWebhook successfully ${userId}`);
    res.status(200).json({
      status: "success",
      message: "Certificate image updated successfully",
      academicDegree: updatedDegree,
    });
  } catch (error) {
    console.error("handleCertificateImageWebhook error:", error);
    res.status(500).json({
      status: "error",
      message: "Error processing certificate image webhook",
      error: error.message,
    });
  }
});
