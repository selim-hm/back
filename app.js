"use strict";

require("dotenv").config();
const express = require("express");
// const { connect } = require("./config/conectet");
const securityMiddleware = require("./middlewares/security");
const {
  errorNotFound,
  errorHandler,
  validationErrorHandler,
  databaseErrorHandler,
  authenticationErrorHandler,
} = require("./middlewares/error");

const app = express();

const initializeApp = async () => {
  try {
    // await connect();

    const orderRouter = require("./users-core/routes/order");
    const chatRouter = require("./users-core/routes/chat");
    const usersRouter = require("./users-core/routes/users");
    const searchRouter = require("./users-core/routes/search");
    const forgetpassword = require("./users-core/routes/forgetpassword");
    const profileRouter = require("./users-core/routes/profile");
    const academicDegreesRouter = require("./users-core/routes/academicDegrees");
    const reviewRoutes = require("./users-core/routes/reviewRoutes");


    var postsRoute = require('./plog-api/routes/postsRoute');
    var commentRoute = require('./plog-api/routes/commentRoute');
    var categoriesRouter = require('./plog-api/routes/categoriesRouter');
    var adminRouter = require('./plog-api/routes/admin');


    const contractRouter = require('./E-commerce/routes/contractRoutes');
    const ecommerceChatRouter = require('./E-commerce/routes/chatRoutes');
    const adminECommerceRouter = require('./E-commerce/routes/admin');
    const ordersRouter = require('./E-commerce/routes/orders');
    const productMerchantRouter = require('./E-commerce/routes/productMerchant');
    const productUserRoutes = require('./E-commerce/routes/productUserRoutes');


    const knowledgeRouter = require('./knowledge-api/routes/knowledgeRoutes');
    const notificationRouter = require("./users-core/routes/notification");
    const friendshipRouter = require("./plog-api/routes/friendshipRoutes");
    const socialChatRouter = require("./plog-api/routes/socialChatRoutes");
    const providerRouter = require("./users-core/routes/provider");


    securityMiddleware(app);


    app.use("/api/users", usersRouter);
    app.use("/api/forget-password", forgetpassword);
    app.use("/api/user", profileRouter);
    app.use("/api/user/academic-degrees", academicDegreesRouter);
    app.use("/api/review", reviewRoutes);
    app.use("/api/order", orderRouter);
    app.use("/api/notifications", notificationRouter);
    app.use("/api/chat", chatRouter);
    app.use("/api/social/friends", friendshipRouter);
    app.use("/api/chat/social", socialChatRouter);

    // Provider routes (doctor, nursing)
    app.use("/api/provider", providerRouter);

    app.use("/api/posts", postsRoute);
    app.use("/api/comment", commentRoute);
    app.use("/api/categories", categoriesRouter);
    app.use("/api/admin", adminRouter);


    app.use("/api/contracts", contractRouter);
    app.use("/api/ecommerce-chat", ecommerceChatRouter);
    app.use("/api/admin-ecommerce", adminECommerceRouter);
    app.use("/api/orders", ordersRouter);
    app.use("/api/product-merchant", productMerchantRouter);
    app.use("/api/product-user", productUserRoutes);

    // Knowledge
    app.use("/api/knowledge", knowledgeRouter);


    app.use(validationErrorHandler);
    app.use(databaseErrorHandler);
    app.use(authenticationErrorHandler);
    app.use(errorNotFound);
    app.use(errorHandler);
  } catch (err) {
    console.error("Failed to initialize app:", err);
    process.exit(1);
  }
};

initializeApp();

module.exports = app;
