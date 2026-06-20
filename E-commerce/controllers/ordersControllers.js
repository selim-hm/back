const prisma = require('../../config/prisma');
const NotificationService = require("../../Notification/notificationService");
const nodemailer = require('nodemailer');
const asyncHandler = require('express-async-handler');
const xss = require('xss');
const Joi = require('joi');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Basket data validation function
const validateAddToCart = (data) => {
    const schema = Joi.object({
        product: Joi.string().required(),
        quantity: Joi.number().min(1).required(),
        price: Joi.number().min(0).required()
    });
    return schema.validate(data);
};

/**
 * @desc   add product in the cart
 * @route   POST /api/orders/addToCart
 * @access  Private (patient/doctor)
 */
exports.addToCart = asyncHandler(async (req, res) => {
    const data = {
        product: xss(req.body.product),
        quantity: parseInt(xss(req.body.quantity), 10),
        price: parseFloat(xss(req.body.price)),
    };

    const { error } = validateAddToCart(data);
    if (error) {
        return res.status(400).json({ message: error.details[0].message });
    }

    const userId = req.user.id || req.user._id;

    const product = await prisma.product.findUnique({ where: { id: data.product } });
    if (!product) {
        return res.status(404).json({ message: 'product not found' });
    }

    if (product.stockQuantity < data.quantity) {
        return res.status(400).json({ message: 'not enough stock' });
    }

    await prisma.product.update({
        where: { id: data.product },
        data: {
            stockQuantity: product.stockQuantity - data.quantity,
            ReservedQuantity: product.ReservedQuantity + data.quantity
        }
    });

    if (product.price !== data.price) {
        return res.status(400).json({ message: 'price not match' });
    }

    // Find pending order
    const order = await prisma.ecommerceOrder.findFirst({
        where: { userId: userId, orderStatus: 'pending' },
        include: { items: true }
    });

    if (!order) {
        const newOrder = await prisma.ecommerceOrder.create({
            data: {
                userId: userId,
                totalAmount: data.price * data.quantity,
                orderStatus: 'pending',
                items: {
                    create: {
                        productId: data.product,
                        quantity: data.quantity,
                        price: data.price
                    }
                }
            },
            include: { items: true }
        });
        
        const adaptedOrder = { ...newOrder, _id: newOrder.id, items: newOrder.items.map(i => ({ ...i, product: i.productId })) };
        
        return res.status(201).json({ message: 'product added to cart', order: adaptedOrder });
    } else {
        const itemIndex = order.items.findIndex(item => item.productId === data.product);

        if (itemIndex > -1) {
            const existingItem = order.items[itemIndex];
            await prisma.orderItem.update({
                where: { id: existingItem.id },
                data: {
                    quantity: existingItem.quantity + data.quantity,
                    price: data.price
                }
            });
        } else {
            await prisma.orderItem.create({
                data: {
                    orderId: order.id,
                    productId: data.product,
                    quantity: data.quantity,
                    price: data.price
                }
            });
        }

        const updatedOrder = await prisma.ecommerceOrder.update({
            where: { id: order.id },
            data: {
                totalAmount: order.totalAmount + (data.price * data.quantity)
            },
            include: { items: true }
        });

        const adaptedOrder = { ...updatedOrder, _id: updatedOrder.id, items: updatedOrder.items.map(i => ({ ...i, product: i.productId })) };

        return res.status(200).json({ message: 'product added to cart', order: adaptedOrder });
    }
});

/**
 * @desc   remove product from the cart
 * @route   DELETE /api/orders/remove-from-cart/:id
 * @access  Private
 */
exports.removeFromCart = asyncHandler(async (req, res) => {
    const userId = req.user.id || req.user._id;
    const productId = req.params.id;

    const order = await prisma.ecommerceOrder.findFirst({
        where: { userId: userId, orderStatus: 'pending' },
        include: { items: true }
    });

    if (!order) {
        return res.status(404).json({ message: 'order not found' });
    }

    const itemToRemove = order.items.find(item => item.productId === productId);
    if (!itemToRemove) {
        return res.status(404).json({ message: 'item not found in cart' });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
        return res.status(404).json({ message: 'product not found' });
    }

    // Restore stock
    await prisma.product.update({
        where: { id: productId },
        data: {
            stockQuantity: product.stockQuantity + itemToRemove.quantity,
            ReservedQuantity: product.ReservedQuantity - itemToRemove.quantity
        }
    });

    await prisma.orderItem.delete({ where: { id: itemToRemove.id } });

    await prisma.ecommerceOrder.update({
        where: { id: order.id },
        data: {
            totalAmount: order.totalAmount - (itemToRemove.price * itemToRemove.quantity)
        }
    });

    return res.status(200).json({ message: 'item removed from cart' });
});

/**
 * @desc   get cart items
 * @route   GET /api/orders/cart-items
 * @access  Private
 */
exports.getCartItems = asyncHandler(async (req, res) => {
    const userId = req.user.id || req.user._id;

    const order = await prisma.ecommerceOrder.findFirst({
        where: { userId: userId, orderStatus: 'pending' },
        include: {
            items: {
                include: { product: { select: { id: true, name: true, price: true, imageUrl: true } } }
            }
        }
    });

    if (!order) {
        return res.status(404).json({ message: 'order not found' });
    }

    const adaptedOrder = {
        ...order,
        _id: order.id,
        items: order.items.map(i => ({
            ...i,
            _id: i.id,
            product: { ...i.product, _id: i.product.id, imageUrl: i.product.imageUrl[0] || '' }
        }))
    };

    return res.status(200).json({ order: adaptedOrder });
});

/**
 * @desc   checkout — places the order and notifies pharmacy
 * @route   POST /api/orders/checkout
 * @access  Private
 */
exports.checkout = asyncHandler(async (req, res) => {
    const data = {
        address: xss(req.body.address),
        paymentMethod: xss(req.body.paymentMethod),
    };
    
    const userId = req.user.id || req.user._id;
    const orderAddress = data.address || req.user.address;

    const order = await prisma.ecommerceOrder.findFirst({
        where: { userId: userId, orderStatus: 'pending' },
        include: { items: { include: { product: true } } }
    });

    if (!order || order.items.length === 0) {
        return res.status(400).json({ message: order ? 'cart is empty' : 'order not found' });
    }

    const firstProduct = order.items[0].product;
    const pharmacyId = firstProduct.merchantId;

    // Assign shipping company based on Contracts
    const contract = await prisma.contract.findFirst({
        where: { pharmacyId: pharmacyId, status: 'accepted' }
    });

    let shippingCompanyId;
    if (contract) {
        shippingCompanyId = contract.shippingCompanyId;
    } else {
        const shippingCompanies = await prisma.user.findMany({
            where: { role: 'shipping_company' },
            select: { id: true }
        });
        if (shippingCompanies.length === 0) {
            return res.status(404).json({ message: 'no shipping companies found' });
        }
        const randomIndex = Math.floor(Math.random() * shippingCompanies.length);
        shippingCompanyId = shippingCompanies[randomIndex].id;
    }

    // Update order with shipping info
    await prisma.ecommerceOrder.update({
        where: { id: order.id },
        data: {
            ShippingCompanyId: shippingCompanyId,
            shippingAddress: orderAddress,
            paymentMethod: data.paymentMethod
        }
    });

    if (data.paymentMethod === 'credit_card') {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: order.items.map(item => ({
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: item.product.name,
                        images: item.product.imageUrl.length ? [item.product.imageUrl[0]] : [],
                    },
                    unit_amount: Math.round(item.price * 100),
                },
                quantity: item.quantity,
            })),
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL}/success`,
            cancel_url: `${process.env.FRONTEND_URL}/cancel`,
            client_reference_id: order.id,
        });
        return res.status(200).json({ session });
        
    } else if (data.paymentMethod === 'monetary') {
        // Change status to "preparing" — pharmacy is being notified
        const updatedOrder = await prisma.ecommerceOrder.update({
            where: { id: order.id },
            data: { orderStatus: 'preparing' },
            include: {
                user: { select: { id: true, username: true, email: true } },
                items: { include: { product: { include: { merchant: { select: { id: true, username: true, fcmTokens: true } } } } } }
            }
        });

        // Notify pharmacy that a new order arrived (FCM push)
        try {
            const pharmacyUser = await prisma.user.findUnique({
                where: { id: pharmacyId },
                select: { fcmTokens: true, username: true }
            });

            if (pharmacyUser && pharmacyUser.fcmTokens && pharmacyUser.fcmTokens.length > 0) {
                await NotificationService.sendToMultipleDevices(
                    pharmacyUser.fcmTokens,
                    "طلب جديد وصلك! 🛍️",
                    `وصل طلب جديد من ${req.user.username}. يرجى تجهيز الأدوية.`,
                    { orderId: order.id, type: "NEW_ORDER_PHARMACY", userId: userId }
                );
            }
        } catch (notifError) {
            console.error("Failed to notify pharmacy:", notifError);
        }

        // Create database notification for pharmacy
        try {
            const { createNotification } = require("../../users-core/util/notificationHelper");
            await createNotification(
                pharmacyId,
                "طلب جديد وصلك! 🛍️",
                `وصل طلب جديد من ${req.user.username}. يرجى تجهيز الأدوية.`,
                "order",
                `/pharmacy/orders`
            );
            // Also notify patient
            await createNotification(
                userId,
                "تم تأكيد طلبك",
                `تم إرسال طلبك إلى الصيدلية بنجاح وجاري التجهيز`,
                "order",
                `/patient/orders/${order.id}`
            );
        } catch (dbNotifErr) {
            console.error("Failed to create database notification:", dbNotifErr.message);
        }

        return res.status(200).json({ message: 'order placed successfully, pharmacy notified', order: { ...updatedOrder, _id: updatedOrder.id } });
    } else {
        return res.status(400).json({ message: 'invalid payment method' });
    }
});

/**
 * @desc   Pharmacy marks order as ready for pickup
 * @route   PUT /api/orders/mark-ready/:id
 * @access  Private (pharmacy only)
 */
exports.markOrderReady = asyncHandler(async (req, res) => {
    if (req.user.role !== 'pharmacy') {
        return res.status(403).json({ message: 'Only pharmacies can mark orders as ready' });
    }

    const orderId = req.params.id;
    const pharmacyId = req.user.id || req.user._id;

    const order = await prisma.ecommerceOrder.findUnique({
        where: { id: orderId },
        include: {
            items: { include: { product: true } },
            user: { select: { id: true, username: true, email: true, fcmTokens: true } },
            ShippingCompany: { select: { id: true, username: true, fcmTokens: true } }
        }
    });

    if (!order) {
        return res.status(404).json({ message: 'Order not found' });
    }

    // Verify the pharmacy owns this order's products
    const orderBelongsToPharmacy = order.items.some(item => item.product.merchantId === pharmacyId);
    if (!orderBelongsToPharmacy) {
        return res.status(403).json({ message: 'This order does not belong to your pharmacy' });
    }

    if (order.orderStatus !== 'preparing') {
        return res.status(400).json({ message: `Cannot mark as ready — current status is '${order.orderStatus}'` });
    }

    const updatedOrder = await prisma.ecommerceOrder.update({
        where: { id: orderId },
        data: { orderStatus: 'ready' }
    });

    // Notify shipping company that order is ready for pickup
    try {
        if (order.ShippingCompany && order.ShippingCompany.fcmTokens && order.ShippingCompany.fcmTokens.length > 0) {
            await NotificationService.sendToMultipleDevices(
                order.ShippingCompany.fcmTokens,
                "الطلب جاهز للاستلام! 📦",
                `الطلب #${orderId.slice(-8)} جاهز للاستلام من الصيدلية. توجه لاستلامه.`,
                { orderId: orderId, type: "ORDER_READY_FOR_PICKUP", pharmacyAddress: order.items[0]?.product?.Address }
            );
        }
    } catch (notifError) {
        console.error("Failed to notify shipping company:", notifError);
    }

    // Notify customer that pharmacy is preparing & shipping company is on the way
    try {
        if (order.user && order.user.fcmTokens && order.user.fcmTokens.length > 0) {
            await NotificationService.sendToMultipleDevices(
                order.user.fcmTokens,
                "تم تجهيز طلبك! 🚀",
                `صيدليتك انتهت من تجهيز طلبك وشركة التوصيل في طريقها لاستلامه.`,
                { orderId: orderId, type: "ORDER_READY_USER_NOTIF" }
            );
        }
    } catch (notifError) {
        console.error("Failed to notify user:", notifError);
    }

    return res.status(200).json({ message: 'Order marked as ready. Shipping company notified.', order: { ...updatedOrder, _id: updatedOrder.id } });
});

/**
 * @desc   Shipping company marks order as picked up from pharmacy
 * @route   PUT /api/orders/mark-picked-up/:id
 * @access  Private (shipping_company only)
 */
exports.markOrderPickedUp = asyncHandler(async (req, res) => {
    if (req.user.role !== 'shipping_company') {
        return res.status(403).json({ message: 'Only shipping companies can mark orders as picked up' });
    }

    const orderId = req.params.id;
    const shippingId = req.user.id || req.user._id;

    const order = await prisma.ecommerceOrder.findUnique({
        where: { id: orderId },
        include: {
            user: { select: { id: true, username: true, email: true, fcmTokens: true } }
        }
    });

    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.ShippingCompanyId !== shippingId) {
        return res.status(403).json({ message: 'This order is not assigned to your company' });
    }
    if (order.orderStatus !== 'ready') {
        return res.status(400).json({ message: `Cannot pick up — current status is '${order.orderStatus}'` });
    }

    const updatedOrder = await prisma.ecommerceOrder.update({
        where: { id: orderId },
        data: { orderStatus: 'shipped' }
    });

    // Notify customer that shipment is on the way
    try {
        if (order.user && order.user.fcmTokens && order.user.fcmTokens.length > 0) {
            await NotificationService.sendToMultipleDevices(
                order.user.fcmTokens,
                "طلبك في الطريق إليك! 🚗",
                `شركة التوصيل استلمت طلبك وهي في طريقها إليك الآن.`,
                { orderId: orderId, type: "ORDER_PICKED_UP" }
            );
        }
    } catch (notifError) {
        console.error("Failed to notify user:", notifError);
    }

    return res.status(200).json({ message: 'Order picked up. Customer notified.', order: { ...updatedOrder, _id: updatedOrder.id } });
});

/**
 * @desc   webhook (Stripe)
 * @route   POST /api/orders/webhook
 * @access  Public (Stripe webhook)
 */
exports.webhook = asyncHandler(async (req, res) => {
    const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        const order = await prisma.ecommerceOrder.findFirst({
            where: { id: session.client_reference_id, orderStatus: 'pending' },
            include: {
                user: true,
                ShippingCompany: true,
                items: { include: { product: { include: { merchant: true } } } }
            }
        });

        if (!order) {
            return res.status(404).json({ message: 'order not found' });
        }

        // Move to 'preparing' after stripe payment — notify pharmacy
        const updatedOrder = await prisma.ecommerceOrder.update({
            where: { id: order.id },
            data: {
                orderStatus: 'preparing',
                paymentStatus: 'paid'
            }
        });

        const pharmacyId = order.items[0]?.product?.merchantId;
        if (pharmacyId) {
            try {
                const pharmacyUser = await prisma.user.findUnique({
                    where: { id: pharmacyId },
                    select: { fcmTokens: true }
                });
                if (pharmacyUser && pharmacyUser.fcmTokens && pharmacyUser.fcmTokens.length > 0) {
                    await NotificationService.sendToMultipleDevices(
                        pharmacyUser.fcmTokens,
                        "طلب جديد مدفوع! 💳",
                        `وصل طلب مدفوع جديد. يرجى تجهيز الأدوية.`,
                        { orderId: order.id, type: "NEW_ORDER_PAID_PHARMACY" }
                    );
                }
            } catch (err) {
                console.error("Pharmacy notification error:", err);
            }
        }

        const shippingFee = order.totalAmount * 0.1;
        const merchantAmount = order.totalAmount - shippingFee;
        
        return res.status(200).json({
            message: 'تم معالجة الطلب بنجاح',
            order: updatedOrder,
            transfers: { merchant: merchantAmount, shipping: shippingFee }
        });
    }
    
    return res.status(400).json({ message: 'نوع الحدث غير صالح' });
});

/**
 * @desc  Get pharmacy's incoming orders (pending/preparing/ready)
 * @route  GET /api/orders/pharmacy-orders
 * @access  Private (pharmacy only)
 */
exports.getPharmacyOrders = asyncHandler(async (req, res) => {
    if (req.user.role !== 'pharmacy') {
        return res.status(403).json({ message: 'Only pharmacies can access this route' });
    }

    const pharmacyId = req.user.id || req.user._id;
    const { status } = req.query;

    const whereClause = {
        items: {
            some: {
                product: { merchantId: pharmacyId }
            }
        }
    };

    if (status) {
        whereClause.orderStatus = status;
    } else {
        whereClause.orderStatus = { in: ['preparing', 'ready', 'shipped', 'delivered', 'cancelled'] };
    }

    const orders = await prisma.ecommerceOrder.findMany({
        where: whereClause,
        include: {
            user: { select: { id: true, username: true, email: true, phone: true, address: true, avatar: true } },
            ShippingCompany: { select: { id: true, username: true, phone: true, avatar: true } },
            items: {
                include: {
                    product: {
                        select: { id: true, name: true, price: true, imageUrl: true, merchantId: true }
                    }
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    const adaptedOrders = orders.map(o => ({
        ...o,
        _id: o.id,
        user: o.user ? { ...o.user, _id: o.user.id } : null,
        ShippingCompany: o.ShippingCompany ? { ...o.ShippingCompany, _id: o.ShippingCompany.id } : null,
        items: o.items.map(i => ({ ...i, _id: i.id, product: { ...i.product, _id: i.product.id, imageUrl: i.product.imageUrl[0] || '' } }))
    }));

    return res.status(200).json({ orders: adaptedOrders });
});

/**
 * @desc  get all orders for a user (shipped/delivered)
 * @route  GET /api/orders/all-orders
 * @access  Private
 */
exports.getAllOrders = asyncHandler(async (req, res) => {
    const userId = req.user.id || req.user._id;

    const orders = await prisma.ecommerceOrder.findMany({
        where: {
            userId: userId,
            orderStatus: { in: ['preparing', 'ready', 'shipped', 'delivered', 'cancelled'] }
        },
        include: {
            items: { include: { product: { select: { id: true, name: true, price: true, imageUrl: true } } } },
            ShippingCompany: { select: { id: true, username: true, phone: true, avatar: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    if (!orders || orders.length === 0) {
        return res.status(404).json({ message: 'no orders found' });
    }
    
    const adaptedOrders = orders.map(o => ({
        ...o,
        _id: o.id,
        items: o.items.map(i => ({
            ...i,
            _id: i.id,
            product: { ...i.product, _id: i.product.id, imageUrl: i.product.imageUrl[0] || '' }
        }))
    }));
    return res.status(200).json({ orders: adaptedOrders });
});

/**
 * @desc  get order tracking details
 * @route  GET /api/orders/track/:id
 * @access  Private
 */
exports.trackOrder = asyncHandler(async (req, res) => {
    const userId = req.user.id || req.user._id;
    const orderId = req.params.id;

    const order = await prisma.ecommerceOrder.findUnique({
        where: { id: orderId },
        include: {
            user: { select: { id: true, username: true, email: true } },
            ShippingCompany: { select: { id: true, username: true, phone: true, avatar: true } },
            items: {
                include: {
                    product: {
                        include: {
                            merchant: { select: { id: true, username: true, phone: true, address: true, avatar: true } }
                        }
                    }
                }
            }
        }
    });

    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Allow: owner, pharmacy, or shipping company
    const pharmacyId = order.items[0]?.product?.merchantId;
    const isOwner = order.userId === userId;
    const isPharmacy = pharmacyId === userId;
    const isShipping = order.ShippingCompanyId === userId;

    if (!isOwner && !isPharmacy && !isShipping) {
        return res.status(403).json({ message: 'Access denied' });
    }

    // Build timeline
    const statusTimeline = [
        { status: 'pending', label: 'Order placed', done: true },
        { status: 'preparing', label: 'Pharmacy preparing', done: ['preparing', 'ready', 'shipped', 'delivered'].includes(order.orderStatus) },
        { status: 'ready', label: 'Ready for pickup', done: ['ready', 'shipped', 'delivered'].includes(order.orderStatus) },
        { status: 'shipped', label: 'Out for delivery', done: ['shipped', 'delivered'].includes(order.orderStatus) },
        { status: 'delivered', label: 'Delivered', done: order.orderStatus === 'delivered' },
    ];

    return res.status(200).json({
        order: { ...order, _id: order.id },
        timeline: statusTimeline
    });
});

/**
 * @desc  get all shipped orders for shipping company
 * @route  GET /api/orders/shipped
 * @access  Private (shipping_company only)
 */
exports.getShippedOrders = asyncHandler(async (req, res) => {
    if (req.user.role !== 'shipping_company') {
        return res.status(403).json({ message: 'Access denied. Shipping company role required.' });
    }

    try {
        const userId = req.user.id || req.user._id;

        const orders = await prisma.ecommerceOrder.findMany({
            where: {
                ShippingCompanyId: userId,
                orderStatus: { in: ['ready', 'shipped'] }
            },
            include: {
                user: { select: { id: true, username: true, email: true, address: true, phone: true, avatar: true } },
                items: {
                    include: {
                        product: {
                            include: {
                                merchant: { select: { id: true, username: true, phone: true, address: true, avatar: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json(orders.map(o => ({
            ...o,
            _id: o.id,
            items: o.items.map(i => ({
                ...i,
                _id: i.id,
                product: { ...i.product, _id: i.product.id, imageUrl: i.product.imageUrl[0] || '' }
            }))
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @desc   Shipping company marks order as delivered
 * @route   PUT /api/orders/mark-delivered/:id
 * @access  Private (shipping_company only)
 */
exports.markOrderDelivered = asyncHandler(async (req, res) => {
    if (req.user.role !== 'shipping_company') {
        return res.status(403).json({ message: 'Access denied. Shipping company role required.' });
    }

    try {
        const orderId = req.params.id;
        const userId = req.user.id || req.user._id;

        const order = await prisma.ecommerceOrder.findUnique({
            where: { id: orderId },
            include: { user: { select: { id: true, email: true, username: true, fcmTokens: true } } }
        });

        if (!order) return res.status(404).json({ message: 'Order not found' });
        if (order.ShippingCompanyId !== userId) {
            return res.status(403).json({ message: 'Access denied' });
        }
        if (order.orderStatus !== 'shipped') {
            return res.status(400).json({ message: `Cannot mark as delivered — current status is '${order.orderStatus}'` });
        }

        const updated = await prisma.ecommerceOrder.update({
            where: { id: orderId },
            data: { orderStatus: 'delivered', deliveryDate: new Date() }
        });

        // Notify customer via push notification
        try {
            if (order.user?.fcmTokens && order.user.fcmTokens.length > 0) {
                await NotificationService.sendToMultipleDevices(
                    order.user.fcmTokens,
                    "تم توصيل طلبك! ✅",
                    `تم توصيل طلبك بنجاح. نتمنى أن تكون سعيداً بشرائك.`,
                    { orderId: orderId, type: "ORDER_DELIVERED" }
                );
            }
        } catch (pushError) {
            console.error("Failed to send push notification:", pushError);
        }

        // Send email to user
        if (order.user?.email) {
            try {
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: process.env.EMAIL, pass: process.env.EMAIL_PASSWORD }
                });
                await transporter.sendMail({
                    from: process.env.EMAIL,
                    to: order.user.email,
                    subject: '✅ تم توصيل طلبك | CareNexus',
                    html: `
                        <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right; padding: 20px;">
                            <h2 style="color: #00b894;">تم توصيل طلبك بنجاح! 🎉</h2>
                            <p>مرحباً ${order.user.username},</p>
                            <p>يسعدنا إبلاغك بأن طلبك رقم <strong>#${orderId.slice(-8)}</strong> تم توصيله بنجاح.</p>
                            <p>شكراً لثقتك في CareNexus.</p>
                        </div>
                    `
                });
            } catch (emailError) {
                console.error('Error sending email:', emailError);
            }
        }

        res.status(200).json({ message: 'Order marked as delivered', order: { ...updated, _id: updated.id } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @desc  Get all completed deliveries for shipping company
 * @route  GET /api/orders/completed-deliveries
 * @access  Private (shipping_company only)
 */
exports.getCompletedDeliveries = asyncHandler(async (req, res) => {
    if (req.user.role !== 'shipping_company') {
        return res.status(403).json({ message: 'Access denied.' });
    }

    const userId = req.user.id || req.user._id;

    const orders = await prisma.ecommerceOrder.findMany({
        where: { ShippingCompanyId: userId, orderStatus: 'delivered' },
        include: {
            user: { select: { id: true, username: true, email: true, phone: true, avatar: true } },
            items: {
                include: {
                    product: { select: { id: true, name: true, price: true, imageUrl: true } }
                }
            }
        },
        orderBy: { deliveryDate: 'desc' }
    });

    res.status(200).json(orders.map(o => ({
        ...o,
        _id: o.id,
        items: o.items.map(i => ({
            ...i, _id: i.id,
            product: { ...i.product, _id: i.product.id, imageUrl: i.product.imageUrl[0] || '' }
        }))
    })));
});

/**
 * @desc  cancelled order
 * @route  POST /api/orders/cancel-order/:id
 * @access  Private
 */
exports.cancelOrder = asyncHandler(async (req, res) => {
    const userId = req.user.id || req.user._id;

    const order = await prisma.ecommerceOrder.findFirst({
        where: {
            userId: userId,
            orderStatus: { in: ['pending', 'preparing'] }
        },
        include: {
            user: true,
            ShippingCompany: true,
            items: { include: { product: { include: { merchant: true } } } }
        }
    });

    if (!order) {
        return res.status(404).json({ message: 'الطلب غير موجود أو لا يمكن إلغاؤه بعد بدء التوصيل' });
    }

    try {
        // Restore stock for each item
        for (const item of order.items) {
            await prisma.product.update({
                where: { id: item.productId },
                data: {
                    stockQuantity: { increment: item.quantity },
                    ReservedQuantity: { decrement: item.quantity }
                }
            });
        }

        if (order.merchantTransferId) {
            const merchantRefund = order.totalAmount * 0.9;
            await stripe.transfers.createReversal(
                order.merchantTransferId,
                { amount: Math.round(merchantRefund * 100) }
            );
        }

        if (order.shippingTransferId) {
            const shippingRefund = order.totalAmount * 0.1;
            await stripe.transfers.createReversal(
                order.shippingTransferId,
                { amount: Math.round(shippingRefund * 100) }
            );
        }

        if (order.stripePaymentId) {
            await stripe.refunds.create({
                payment_intent: order.stripePaymentId,
                amount: Math.round(order.totalAmount * 100),
            });
        }

        await prisma.ecommerceOrder.update({
            where: { id: order.id },
            data: { orderStatus: 'cancelled' }
        });

        res.status(200).json({ message: 'تم إلغاء الطلب بنجاح' });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'حدث خطأ أثناء الإلغاء',
            error: error.message
        });
    }
});
