export class AppError extends Error {
  constructor(status, code, message, data = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function validationError(field, message) {
  return new AppError(422, 10001, '请检查输入内容', { errors: [{ field, message }] });
}

export function success(res, data, status = 200) {
  return res.status(status).json({ code: 0, message: 'success', data });
}

export function logError(scope, error) {
  // Database error messages can contain SQL or credentials; log only stable identifiers.
  console.error(JSON.stringify({ time: new Date().toISOString(), scope, code: error.code || error.name || 'UNKNOWN' }));
}
