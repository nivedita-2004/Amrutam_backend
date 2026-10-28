const validate = (schemas = {}) => (req, res, next) => {
  const validationErrors = [];

  ['body', 'query', 'params'].forEach((target) => {
    if (schemas[target]) {
      const result = schemas[target].safeParse(req[target]);
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          validationErrors.push({
            target,
            field: issue.path.join('.') || target,
            message: issue.message
          });
        });
      } else {
        req[target] = result.data;
      }
    }
  });

  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Request validation failed',
      errors: validationErrors
    });
  }

  next();
};

module.exports = validate;
