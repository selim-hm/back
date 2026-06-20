const Joi = require("joi");

const formatValidationErrors = (error) => {
  if (!error.details) {
    return "Validation error";
  }

  return error.details.map((detail) => ({
    field: detail.path.join("."),
    message: detail.message,
  }));
};

// ✅ Validate creating a new order (open to providers)
const validateOrderDataController = (data) => {
  const schema = Joi.object({
    serviceType: Joi.string().valid("with_provider", "self_service").required(),
    medicalServiceType: Joi.string()
      .valid("doctor", "nursing", "pharmacy", "hospital", "other")
      .required(),
    patient: Joi.string().required(),
    title: Joi.string().min(3).max(100).required(),
    description: Joi.string().min(5).max(2000).optional(),
    appointmentDate: Joi.date().required(),
    duration: Joi.number().min(1).max(24).required(),
    urgencyLevel: Joi.string().valid("normal", "emergency").default("normal"),
    meetingPoint: Joi.object({
      type: Joi.string().valid("Point").required(),
      coordinates: Joi.array().items(Joi.number()).length(2).required(),
    }).required(),
    status: Joi.string()
      .valid("open", "awaiting_provider_confirmation", "confirmed")
      .optional(),
    price: Joi.number().min(0).required(),
  });

  return schema.validate(data, { abortEarly: false });
};

// ✅ Validate creating an order with a specific provider
const validateOrderDatasController = (data) => {
  const schema = Joi.object({
    serviceType: Joi.string().valid("with_provider").required(),
    medicalServiceType: Joi.string()
      .valid("doctor", "nursing", "pharmacy", "hospital", "other")
      .required(),
    patient: Joi.string().required(),
    provider: Joi.string().required(),
    title: Joi.string().min(3).max(100).required(),
    description: Joi.string().min(5).max(2000).optional(),
    appointmentDate: Joi.date().required(),
    duration: Joi.number().min(1).max(24).required(),
    urgencyLevel: Joi.string().valid("normal", "emergency").default("normal"),
    meetingPoint: Joi.object({
      type: Joi.string().valid("Point").required(),
      coordinates: Joi.array().items(Joi.number()).length(2).required(),
    }).required(),
    status: Joi.string().valid("awaiting_provider_confirmation").optional(),
    price: Joi.number().min(0).required(),
  });

  return schema.validate(data, { abortEarly: false });
};

module.exports = {
  formatValidationErrors,
  validateOrderDataController,
  validateOrderDatasController,
};
