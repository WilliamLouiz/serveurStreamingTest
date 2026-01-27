const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

exports.validateRegister = [
  body('nom').notEmpty().withMessage('Le nom est requis'),
  body('prenom').notEmpty().withMessage('Le prénom est requis'),
  body('email')
    .isEmail().withMessage('Email invalide')
    .custom(async (email) => {
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        throw new Error('Email déjà utilisé');
      }
    }),
  body('password')
    .isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères'),
  body('role')
    .isIn(Object.values(ROLES)).withMessage('Rôle invalide'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

exports.validateLogin = [
  body('email').isEmail().withMessage('Email invalide'),
  body('password').notEmpty().withMessage('Mot de passe requis'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

exports.validateChannel = [
  body('name').notEmpty().withMessage('Le nom du canal est requis'),
  body('description').optional().isLength({ max: 500 }).withMessage('La description ne doit pas dépasser 500 caractères'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

exports.validateAccountVerification = [
  body('token').notEmpty().withMessage('Token de validation requis'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

exports.validateResendEmail = [
  body('email').isEmail().withMessage('Email invalide'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

exports.validateUserAction = [
  body('reason').optional().isLength({ max: 500 }).withMessage('La raison ne doit pas dépasser 500 caractères'),
  body('sendEmail').optional().isBoolean().withMessage('sendEmail doit être un booléen'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];