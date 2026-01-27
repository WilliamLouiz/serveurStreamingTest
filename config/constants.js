module.exports = {
  ROLES: {
    ADMIN: 'admin',
    FORMATEUR: 'formateur',
    STAGIAIRE: 'stagiaire'
  },
  
  ACCOUNT_STATUS: {
    PENDING: 'pending',
    VALIDATED: 'validated',
    REJECTED: 'rejected',
    SUSPENDED: 'suspended'
  },
  
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  VERIFICATION_TOKEN_EXPIRES_IN: '24h',
  
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif'],
  
  EMAIL_TEMPLATES: {
    ACCOUNT_VALIDATED: 'account_validated',
    ACCOUNT_CREATED: 'account_created',
    ACCOUNT_REJECTED: 'account_rejected'
  }
};