import { Schema } from "effect";

export class HttpStatus extends Schema.TaggedErrorClass<HttpStatus>()("HttpStatus", {
  status: Schema.Number,
  detail: Schema.String,
}) {}

export const isHttpStatus = <Value>(value: Value): value is Value & HttpStatus =>
  value instanceof HttpStatus;

export const notFound = (detail: string): HttpStatus => new HttpStatus({ status: 404, detail });

export const badRequest = (detail: string): HttpStatus => new HttpStatus({ status: 400, detail });

export const serviceUnavailable = (detail: string): HttpStatus =>
  new HttpStatus({ status: 503, detail });
