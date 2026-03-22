export function notFound(entity: string) {
  return Response.json(
    { error: "not_found", message: `${entity} not found` },
    { status: 404 },
  );
}

export function conflict(message: string) {
  return Response.json(
    { error: "conflict", message },
    { status: 409 },
  );
}

export function unauthorized(message: string) {
  return Response.json(
    { error: "unauthorized", message },
    { status: 401 },
  );
}

export function forbidden(message: string) {
  return Response.json(
    { error: "forbidden", message },
    { status: 403 },
  );
}

export function validationError(detail: unknown) {
  return Response.json(
    { error: "validation_error", detail },
    { status: 422 },
  );
}
