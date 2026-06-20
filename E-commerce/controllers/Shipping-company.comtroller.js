const asyncHandler = require('express-async-handler');
const nodemailer = require('nodemailer');
const prisma = require('../../config/prisma');

const shipped = (req, res, next) => {
  if (req.user.role !== 'shipping_company') {
    return res.status(403).json({ message: 'Access denied. Shipping company role required.' });
  }
  next();
};

/**
 * @desc get all shipped orders
 * @route /api/orders/shipped
 * @method get
 */
exports.getShippedOrders = [shipped, asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const orders = await prisma.ecommerceOrder.findMany({
      where: { ShippingCompanyId: userId, orderStatus: 'shipped' },
      include: {
        user: { select: { id: true, username: true, email: true, address: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, price: true, imageUrl: true, Address: true } }
          }
        }
      }
    });

    res.status(200).json(orders.map(o => ({ ...o, _id: o.id })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
})];

/**
 * @desc update order status to delivered
 * @route /api/orders/shipped/:id
 * @method put
 */
exports.updateOrderStatus = [shipped, asyncHandler(async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id || req.user._id;

    const order = await prisma.ecommerceOrder.findUnique({
      where: { id: orderId },
      include: { user: { select: { id: true, email: true } } }
    });

    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.ShippingCompanyId !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updated = await prisma.ecommerceOrder.update({
      where: { id: orderId },
      data: { orderStatus: 'delivered', deliveryDate: new Date() }
    });

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
          subject: 'Order Delivered',
          text: `Your order with ID ${orderId} has been delivered.`
        });
      } catch (emailError) {
        console.error('Error sending email:', emailError);
      }
    }

    res.status(200).json({ message: 'Order status updated to delivered', order: { ...updated, _id: updated.id } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
})];