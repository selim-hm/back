// Middleware to validate if the provided ID is a valid UUID (used by Prisma/PostgreSQL)
module.exports = (req, res, next) => {
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  if (!uuidRegex.test(req.params.id)) {
    return res
      .status(400)
      .json({ message: "Invalid ID format (expected UUID)" });
  }
  next();
};
