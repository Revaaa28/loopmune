// LoopMune Patient — tiny helper for HTTP-flavoured errors.
// Patient logic modules throw these; the server maps .status to a response
// code and .message to the JSON error body the storefront displays.

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
