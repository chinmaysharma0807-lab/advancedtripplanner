class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const validationError = (details) => new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', details);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
const notFound = (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found`);
const conflict = (message, details, code = 'CONFLICT') => new AppError(409, code, message, details);
const unavailable = (message, details) => new AppError(503, 'SERVICE_UNAVAILABLE', message, details);

module.exports = { AppError, badRequest, validationError, unauthorized, forbidden, notFound, conflict, unavailable };
