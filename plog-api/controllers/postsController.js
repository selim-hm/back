const asyncHandler = require("express-async-handler");
const cloudinary = require("../../config/cloudinary");
const xss = require("xss");
const Joi = require("joi");
const prisma = require("../../config/prisma");
/**
 * @desc create new post
 * @route api/posts
 * @method post
 * @access private
 * */
exports.createPost = asyncHandler(async (req, res) => {
  try {
    let parsedAllowComments = true;
    if (req.body.allowComments !== undefined) {
      parsedAllowComments =
        req.body.allowComments === "true" || req.body.allowComments === true;
    }

    const data = {
      title: xss(req.body.title),
      description: xss(req.body.description),
      category: xss(req.body.category),
      allowComments: parsedAllowComments,
    };

    // Joi validation for create post
    const schema = Joi.object({
      title: Joi.string().min(1).max(200).required().trim(),
      description: Joi.string().min(1).required().trim(),
      category: Joi.string().required().trim(),
      allowComments: Joi.boolean(),
    });
    const { error } = schema.validate(data);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { title, description, category, allowComments } = data;
    const userId = req.user.id || req.user._id;

    let mediaArr = [];
    let primaryImage =
      "https://cdn.pixabay.com/photo/2021/07/02/04/48/user-6380868_1280.png";

    // ✅ Handle multiple uploaded files
    if (req.files && req.files.length > 0) {
      try {
        const uploadPromises = req.files.map((file) => {
          return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "posts", resource_type: "auto" },
              (err, result) => {
                if (err) return reject(err);
                resolve({
                  url: result.secure_url,
                  publicId: result.public_id,
                  resourceType: result.resource_type,
                });
              },
            );
            stream.end(file.buffer);
          });
        });

        mediaArr = await Promise.all(uploadPromises);

        // Set the first uploaded media as the primary image for backwards compatibility
        if (mediaArr.length > 0 && mediaArr[0].url) {
          primaryImage = mediaArr[0].url;
        }
      } catch (err) {
        console.log("Cloudinary Upload Error:", err);
        return res
          .status(500)
          .json({ error: "Media upload failed, please try again." });
      }
    }

    // ✅ Create Post in Database
    const post = await prisma.post.create({
      data: {
        title,
        description,
        category,
        allowComments,
        userId: userId,
        image: primaryImage,
        media: mediaArr,
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
      },
    });

    // Adapter wrapper
    const adaptedPost = { ...post, _id: post.id };

    res
      .status(201)
      .json({ message: "Post created successfully", post: adaptedPost });
  } catch (error) {
    console.log("Error creating post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc get all posts
 * @route api/posts/add
 * @method get
 * @access public
 * */
exports.getAllPosts = asyncHandler(async (req, res) => {
  try {
    let { namPage, category } = req.query;
    let limit = 10;

    namPage = Number(namPage) || 1;
    if (namPage < 1) namPage = 1;

    const whereClause = category ? { category: String(category) } : {};

    // حساب إجمالي عدد البوستات المطابقة للبحث
    const totalPosts = await prisma.post.count({ where: whereClause });
    const totalPages = Math.ceil(totalPosts / limit);

    const posts = await prisma.post.findMany({
      where: whereClause,
      skip: (namPage - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, username: true, avatar: true, email: true },
        },
        likes: { select: { userId: true, reactionType: true } },
        _count: {
          select: { comments: true },
        },
      },
    });

    if (!posts.length) {
      return res.status(404).json({ error: "Posts not found" });
    }

    const adaptedPosts = posts.map((post) => ({
      ...post,
      _id: post.id,
      user: { ...post.user, _id: post.user.id },
      like: post.likes.map((l) => l.userId),
      likesDetails: post.likes,
      commentsCount: post._count.comments,
    }));

    res.status(200).json({
      posts: adaptedPosts,
      currentPage: namPage,
      totalPages,
      totalPosts,
    });
  } catch (error) {
    console.error("Error getting posts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc get all posts(user)
 * @route api/posts/:id
 * @method get
 * @access private
 * */
exports.getAllPostsUser = asyncHandler(async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: { userId: req.params.id },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        likes: { select: { userId: true, reactionType: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!posts) return res.status(404).json({ error: "Post not found" });

    const adaptedPosts = posts.map((post) => ({
      ...post,
      _id: post.id,
      user: { ...post.user, _id: post.user.id },
      like: post.likes.map((l) => l.userId),
      likesDetails: post.likes,
      commentsCount: post._count?.comments || 0,
    }));

    res.status(200).json(adaptedPosts); // Changed from 201 to 200 since it's GET
  } catch (error) {
    console.error("Error getting posts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc get one post
 * @route api/post/:id
 * @method get
 * @access public or private
 * */
exports.getPost = asyncHandler(async (req, res) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        likes: { select: { userId: true, reactionType: true } },
        comments: {
          include: {
            user: { select: { id: true, username: true, avatar: true } },
            likes: { select: { userId: true } },
          },
        },
        _count: { select: { comments: true } },
      },
    });

    if (!post) return res.status(404).json({ error: "Post not found" });

    const adaptedPost = {
      ...post,
      _id: post.id,
      user: { ...post.user, _id: post.user.id },
      like: post.likes.map((l) => l.userId),
      likesDetails: post.likes,
      commentsCount: post._count?.comments || 0,
      comments: post.comments.map((c) => ({
        ...c,
        _id: c.id,
        user: { ...c.user, _id: c.user.id },
        like: c.likes.map((l) => l.userId),
      })),
    };

    res.status(200).json(adaptedPost);
  } catch (error) {
    console.error("Error getting post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc delete one post(user)
 * @route api/posts/:id
 * @method delete
 * @access private
 * */
exports.deletePost = asyncHandler(async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id || req.user._id;

    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) return res.status(404).json({ error: "Post not found" });

    if (
      req.user.role === "admin" ||
      req.user.isAdmin ||
      userId === post.userId
    ) {
      // حذف الصورة من Cloudinary
      if (post.image) {
        const match = post.image.match(/\/([^\/]+?)(\.[^\/.]*)?$/);
        if (match && match[1]) {
          const publicId = match[1];
          try {
            await cloudinary.uploader.destroy(`posts/${publicId}`);
          } catch (e) {
            console.error("Error deleting image from Cloudinary", e);
          }
        }
      }

      // Delete media array items from Cloudinary
      if (post.media && Array.isArray(post.media)) {
        for (const mediaItem of post.media) {
          if (mediaItem.publicId) {
            try {
              await cloudinary.uploader.destroy(mediaItem.publicId);
            } catch (e) {
              console.error(
                "Error deleting media array item from Cloudinary",
                e,
              );
            }
          }
        }
      }

      // حذف المنشور من قاعدة البيانات (Cascade deletes comments automatically based on schema)
      await prisma.post.delete({ where: { id: postId } });

      res.json({
        message: "Post and all associated data deleted successfully!",
      });
    } else {
      return res.status(403).json({ error: "Unauthorized access" });
    }
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @desc update one post(user)
 * @route api/posts/:id
 * @method put
 * @access private
 * */
exports.updatePost = asyncHandler(async (req, res) => {
  try {
    let parsedAllowComments = undefined;
    if (req.body.allowComments !== undefined) {
      parsedAllowComments =
        req.body.allowComments === "true" || req.body.allowComments === true;
    }

    const data = {
      title: xss(req.body.title),
      description: xss(req.body.description),
      category: xss(req.body.category),
    };
    if (parsedAllowComments !== undefined)
      data.allowComments = parsedAllowComments;

    // Joi validation for update post
    const schema = Joi.object({
      title: Joi.string().min(1).max(200).trim(),
      description: Joi.string().min(1).trim(),
      category: Joi.string().trim(),
      allowComments: Joi.boolean(),
    });
    const { error } = schema.validate(data);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const postId = req.params.id;
    const userId = req.user.id || req.user._id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return res.status(404).json({ message: "post not found" });
    }

    if (userId !== post.userId) {
      return res
        .status(403)
        .json({ message: "access denied, you are not allowed" });
    }

    const updateFields = {};
    if (data.title) updateFields.title = data.title;
    if (data.description) updateFields.description = data.description;
    if (data.category) updateFields.category = data.category;
    if (parsedAllowComments !== undefined)
      updateFields.allowComments = parsedAllowComments;

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      data: updateFields,
      include: { user: { select: { id: true, username: true, avatar: true } } },
    });

    updatedPost._id = updatedPost.id;

    res.json(updatedPost);
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc update photo post(user)
 * @route api/posts/update/:id
 * @method put
 * @access private
 * */
exports.updatePhotoPost = asyncHandler(async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No image provided" });

    const postId = req.params.id;
    const userId = req.user.id || req.user._id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (userId !== post.userId)
      return res
        .status(403)
        .json({ message: "Access denied, you are not allowed" });

    // Delete old primary image if it exists
    if (post.image) {
      const match = post.image.match(/\/([^\/]+?)(\.[^\/.]*)?$/);
      if (match && match[1]) {
        const publicId = `posts/${match[1]}`;
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (e) {
          console.error("Error destroying old image", e);
        }
      }
    }

    // Upload new image
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "posts" },
        (err, result) => (err ? reject(err) : resolve(result)),
      );
      stream.end(req.file.buffer);
    });

    const newImageObj = { url: result.secure_url, publicId: result.public_id };

    const updatedPost = await prisma.post.update({
      where: { id: postId },
      // Storing as JSON string or fallback to secure_url because Prisma Image is String
      // We use secure_url strictly for `image` as per original Prisma constraints
      data: { image: result.secure_url },
    });

    updatedPost._id = updatedPost.id;
    // In legacy code, they set post.image = { url: result.secure_url, publicId: result.public_id } which turns it into JSON!
    // So we just override it in the response for frontend compatibility.
    updatedPost.image = newImageObj;

    res.status(200).json(updatedPost);
  } catch (error) {
    console.error("Error updating post photo:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc like post
 * @route api/posts/:id/like
 * @method put
 * @access private
 * */
exports.likePost = asyncHandler(async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id || req.user._id;
    const { reactionType = "like" } = req.body;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: "Post not found" });

    await prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, reactionType },
      update: { reactionType },
    });

    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        likes: { select: { userId: true, reactionType: true } },
        _count: { select: { comments: true } },
      },
    });

    updatedPost._id = updatedPost.id;
    updatedPost.like = updatedPost.likes.map((l) => l.userId);
    // Include full likes info for frontend to show specific icons
    updatedPost.likesDetails = updatedPost.likes;
    updatedPost.commentsCount = updatedPost._count?.comments || 0;

    res.json(updatedPost);
  } catch (error) {
    console.error("Error liking post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc unlike post
 * @route api/posts/:id/unlike
 * @method put
 * @access private
 * */
exports.unlikePost = asyncHandler(async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id || req.user._id;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: "Post not found" });

    await prisma.postLike.deleteMany({
      where: { postId, userId },
    });

    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        likes: { select: { userId: true, reactionType: true } },
        _count: { select: { comments: true } },
      },
    });

    updatedPost._id = updatedPost.id;
    updatedPost.like = updatedPost.likes.map((l) => l.userId);
    updatedPost.likesDetails = updatedPost.likes;
    updatedPost.commentsCount = updatedPost._count?.comments || 0;

    res.json(updatedPost);
  } catch (error) {
    console.error("Error unliking post:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @desc get all posts (ADMIN)
 * @route api/posts/allposts
 * @method get
 * @access public (admin only)
 * */
exports.getAllPostsAdmin = asyncHandler(async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        likes: { select: { userId: true, reactionType: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const adaptedPosts = posts.map((post) => ({
      ...post,
      _id: post.id,
      user: { ...post.user, _id: post.user.id },
      like: post.likes.map((l) => l.userId),
      likesDetails: post.likes,
      commentsCount: post._count?.comments || 0,
    }));

    res.status(200).json(adaptedPosts);
  } catch (error) {
    console.error("Error admin getting posts:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
