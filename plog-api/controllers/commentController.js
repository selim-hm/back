const asyncHandler = require("express-async-handler");
const xss = require("xss");
const Joi = require("joi");
const prisma = require("../../config/prisma");

/**
 * @desc إنشاء تعليق جديد (ممكن يكون تعليق رئيسي أو رد على تعليق آخر)
 * @route POST api/comment/:postId/comments
 */
exports.createComment = asyncHandler(async (req, res) => {
  try {
    const data = {
      text: xss(req.body.text),
      parentComment: req.body.parentComment
        ? String(xss(req.body.parentComment))
        : null,
    };

    const schema = Joi.object({
      text: Joi.string().min(1).required().trim(),
      parentComment: Joi.string().optional().allow(null, ""),
    });
    const { error } = schema.validate(data);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.id || req.user._id;

    const comment = await prisma.comment.create({
      data: {
        text: data.text,
        userId: userId,
        postId: req.params.id,
        parentCommentId: data.parentComment,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            email: true,
          },
        },
      },
    });

    // Adapt the response for legacy clients expecting _id
    const adaptedComment = {
      ...comment,
      _id: comment.id,
      user: { ...comment.user, _id: comment.user.id },
    };

    res.status(201).json(adaptedComment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc جلب جميع التعليقات المرتبطة بمنشور معين بشكل هرمي (nested)
 * @route GET api/comment/:postId/comments
 */
exports.getAllCommentsForPost = asyncHandler(async (req, res) => {
  try {
    const allComments = await prisma.comment.findMany({
      where: { postId: req.params.id },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        likes: { select: { userId: true } }, // Fetch likes to compute count and legacy array
      },
      orderBy: { createdAt: "asc" },
    });

    // بناء شجرة التعليقات
    const commentMap = new Map();

    // Prepare comment objects with adapter fields
    const formattedComments = allComments.map((c) => {
      const likeIds = c.likes.map((l) => l.userId);
      return {
        ...c,
        _id: c.id,
        user: { ...c.user, _id: c.user.id },
        like: likeIds, // Mapping the legacy array structure
        parentComment: c.parentCommentId,
        replies: [],
      };
    });

    formattedComments.forEach((comment) => {
      commentMap.set(comment.id, comment);
    });

    const nestedComments = [];
    formattedComments.forEach((comment) => {
      if (comment.parentComment) {
        const parent = commentMap.get(comment.parentComment);
        if (parent) {
          parent.replies.push(comment);
        } else {
          nestedComments.push(comment);
        }
      } else {
        nestedComments.push(comment);
      }
    });

    res.status(200).json(nestedComments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc حذف تعليق معين
 * @route DELETE api/comments/:commentId
 */
exports.deleteComment = asyncHandler(async (req, res) => {
  try {
    const commentId = req.params.commentId;
    const userId = req.user.id || req.user._id;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { user: { select: { id: true } } },
    });

    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // السماح بالحذف فقط للمسؤول أو صاحب التعليق
    if (
      req.user.role === "admin" ||
      req.user.isAdmin ||
      userId === comment.userId
    ) {
      await prisma.comment.delete({ where: { id: commentId } });
      res.json({ message: "Comment deleted successfully!" });
    } else {
      res.status(403).json({ error: "Unauthorized" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc تعديل تعليق معين
 * @route PUT api/comments/:commentId
 */
exports.updateComment = asyncHandler(async (req, res) => {
  try {
    const data = {
      text: xss(req.body.text),
    };

    const schema = Joi.object({
      text: Joi.string().min(1).required().trim(),
    });
    const { error } = schema.validate(data);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const commentId = req.params.commentId;
    const userId = req.user.id || req.user._id;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    if (
      req.user.role === "admin" ||
      req.user.isAdmin ||
      userId === comment.userId
    ) {
      const updatedComment = await prisma.comment.update({
        where: { id: commentId },
        data: { text: data.text },
        include: {
          user: { select: { id: true, username: true, avatar: true } },
        },
      });

      // Map response format
      updatedComment._id = updatedComment.id;
      updatedComment.user._id = updatedComment.user.id;

      return res.json(updatedComment);
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc toggle like comment
 * @route api/comment/:id/like
 * @method put
 * @access private
 * */
exports.likeComment = asyncHandler(async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id || req.user._id;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // Upsert logic for like
    await prisma.commentLike.upsert({
      where: {
        commentId_userId: { commentId, userId },
      },
      create: { commentId, userId },
      update: {}, // do nothing if it already exists
    });

    // Refetch structured comment
    const updatedComment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { likes: { select: { userId: true } } },
    });

    updatedComment._id = updatedComment.id;
    updatedComment.like = updatedComment.likes.map((l) => l.userId);

    res.json(updatedComment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc toggle unlike comment
 * @route api/comment/:id/unlike
 * @method put
 * @access private
 * */
exports.unlikeComment = asyncHandler(async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id || req.user._id;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    await prisma.commentLike.deleteMany({
      where: { commentId, userId },
    });

    const updatedComment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { likes: { select: { userId: true } } },
    });

    updatedComment._id = updatedComment.id;
    updatedComment.like = updatedComment.likes.map((l) => l.userId);

    res.json(updatedComment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc get all comments
 * @route api/comments
 * @method get
 * @access public (admin only)
 * */
exports.getAllComments = asyncHandler(async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      include: {
        user: {
          select: { id: true, username: true, avatar: true, email: true },
        },
        likes: { select: { userId: true } },
      },
    });

    const formattedComments = comments.map((c) => {
      return {
        ...c,
        _id: c.id,
        user: { ...c.user, _id: c.user.id },
        like: c.likes.map((l) => l.userId),
      };
    });

    res.status(200).json(formattedComments); // Status code 200 instead of 201 for GET
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
