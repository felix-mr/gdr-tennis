export function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) throw new Error('Firestore cannot store nested arrays.');
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object' && value) return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toFirestoreValue(entry)])) } };
  throw new Error('Unsupported Firestore value.');
}

export function fromFirestoreValue(value) {
  if ('nullValue' in value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, entry]) => [key, fromFirestoreValue(entry)]));
  throw new Error('Unsupported Firestore response.');
}
