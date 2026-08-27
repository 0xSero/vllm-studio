import { Schema } from "effect";

export type UnparsedValue = typeof Schema.Unknown.Encoded;
export type UnknownRecord = { [key: string]: UnparsedValue };

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const matchesUnknownRecord = Schema.is(UnknownRecordSchema);

export function isRecord(value: UnparsedValue): value is UnknownRecord {
  return matchesUnknownRecord(value);
}
