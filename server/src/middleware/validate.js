const mongoose = require('mongoose');
const { validationError, badRequest } = require('../utils/errors');

/**
 * Validate and coerce req.body / req.query / req.params with zod schemas.
 * Parsed values replace the originals so unknown keys never reach services.
 */
const validate = (schemas) => (req, res, next) => {
  try {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        throw validationError(
          result.error.issues.map((i) => ({ path: [part, ...i.path].join('.'), message: i.message }))
        );
      }
      if (part === 'query') req.validatedQuery = result.data;
      else req[part] = result.data;
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** Reject route params that are not valid ObjectIds before they reach Mongo. */
const validateObjectIds =
  (...names) =>
  (req, res, next) => {
    for (const name of names) {
      const value = req.params[name];
      if (!mongoose.isValidObjectId(value) || String(new mongoose.Types.ObjectId(value)) !== value) {
        return next(badRequest(`Invalid ${name}`));
      }
    }
    return next();
  };

module.exports = { validate, validateObjectIds };
