// src/lib/emailValidation.ts
// Shared email validation for client form and server API endpoint.

export const EMAIL_REGEX =
  /^[A-Za-z0-9._%+'-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const EMAIL_ERROR_MESSAGE =
  'Please enter a complete email address, including the domain (e.g. name@company.com).';

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 254) return false;
  if (trimmed.includes('..')) return false;
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1 || atIndex !== trimmed.lastIndexOf('@')) return false;
  return EMAIL_REGEX.test(trimmed);
}
