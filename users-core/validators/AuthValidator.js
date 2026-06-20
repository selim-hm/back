// users/validators/AuthValidator.js
/**
 * ✅ Authentication & User Validation Schemas
 * Validates all user authentication and profile operations
 */

const Joi = require("joi");
const passwordComplexity = require("joi-password-complexity");

// Password complexity configuration
const complexityOptions = {
  min: 8,
  max: 30,
  lowerCase: 1,
  upperCase: 1,
  numeric: 1,
  symbol: 1,
  requirementCount: 4,
};
const locationSchema = Joi.object({
  type: Joi.string().valid("Point").required(),
  coordinates: Joi.array().items(Joi.number()).length(2).required(),
});

// ✅ Validate user registration
const validateRegister = (data) => {
  const schema = Joi.object({
    role: Joi.string()
      .required()
      .valid("doctor", "nursing", "patient", "pharmacy", "hospital", "admin")
      .messages({
        "any.only":
          "Role must be one of: doctor, nursing, patient, pharmacy, hospital, admin",
        "any.required": "Role is required",
      }),
    username: Joi.string().required().min(3).max(30).trim().messages({
      "string.empty": "Username is required",
      "string.min": "Username must be at least 3 characters",
      "string.max": "Username cannot exceed 30 characters",
    }),

    email: Joi.string().required().email().lowercase().messages({
      "string.empty": "Email is required",
      "string.email": "Email must be valid",
    }),

    password: passwordComplexity(complexityOptions).required().messages({
      "any.required": "Password is required",
      "passwordComplexity.min": "Password must be at least 8 characters",
      "passwordComplexity.lowercase":
        "Password must contain at least 1 lowercase letter",
      "passwordComplexity.uppercase":
        "Password must contain at least 1 uppercase letter",
      "passwordComplexity.numeric": "Password must contain at least 1 number",
      "passwordComplexity.symbol": "Password must contain at least 1 symbol",
    }),

    phone: Joi.string()
      .pattern(/^[0-9+\-\(\)\s]+$/)
      .max(20)
      .messages({
        "string.pattern.base": "Phone number format is invalid",
      }),
    // International identity number (passport, national ID, etc.)
    identityNumber: Joi.string()
      .min(5)
      .max(30)
      .pattern(/^[A-Za-z0-9]+$/)
      .required()
      .messages({
        "string.pattern.base":
          "Identity number must contain only letters and numbers",
        "string.min": "Identity number must be at least 5 characters",
        "string.max": "Identity number cannot exceed 30 characters",
        "any.required": "Identity number is required",
      }),
    IpPhone: Joi.string().allow("", null).messages({
      "string.base": "IpPhone must be a string",
    }),
    location: locationSchema.required().messages({
      "any.required": "Location is required",
    }),

    country: Joi.string().max(100).messages({
      "string.max": "Country cannot exceed 100 characters",
    }),
    Address: Joi.string().max(200).messages({
      "string.max": "Address cannot exceed 200 characters",
    }),

    gender: Joi.string().required().valid("male", "female", "other").messages({
      "any.only": "Gender must be one of: male, female, other",
      "any.required": "Gender is required",
    }),
  });

  return schema.validate(data, { abortEarly: false });
};

// ✅ Validate user login
const validateLogin = (data) => {
  const schema = Joi.object({
    identifier: Joi.string().required().messages({
      "string.empty": "Email, Phone or Username is required",
      "any.required": "Email, Phone or Username is required",
    }),
    password: Joi.string().required().messages({
      "string.empty": "Password is required",
      "any.required": "Password is required",
    }),
    fcmToken: Joi.string().optional().messages({
      "string.base": "FCM Token must be a string",
    }),
  });

  return schema.validate(data, { abortEarly: false });
};

// ✅ Validate profile update
const validateProfileUpdate = (data) => {
  const schema = Joi.object({
    phone: Joi.string()
      .pattern(/^[0-9+\-\(\)\s]+$/)
      .max(20)
      .messages({
        "string.pattern.base": "Phone number format is invalid",
      }),
    description: Joi.string().max(500).allow("").optional().messages({
      "string.max": "Description cannot exceed 500 characters",
    }),
    specialization: Joi.string().max(100).allow("").optional().messages({
      "string.max": "Specialization cannot exceed 100 characters",
    }),
    gender: Joi.string().required().valid("male", "female", "other").messages({
      "any.only": "Gender must be one of: male, female, other",
      "any.required": "Gender is required",
    }),
    academicDegrees: Joi.array()
      .items(
        Joi.object({
          degree: Joi.string()
            .valid("bachelor", "master", "phd", "diploma", "associate", "other")
            .required(),
          field: Joi.string().required().allow(""),
          institution: Joi.string().required().allow(""),
          graduationYear: Joi.number()
            .integer()
            .min(1950)
            .max(new Date().getFullYear()),
          certificateImage: Joi.string().uri().allow(null, ""),
        }),
      )
      .optional(),
    coverPhoto: Joi.string().uri().allow(null, "").optional(),
  });

  return schema.validate(data, { abortEarly: false });
};

// ✅ Format validation errors
const formatValidationErrors = (error) => {
  if (!error.details) {
    return "Validation error";
  }

  return error.details.map((detail) => ({
    field: detail.path.join("."),
    message: detail.message,
  }));
};

module.exports = {
  validateRegister,
  validateLogin,
  validateProfileUpdate,
  formatValidationErrors,
};
