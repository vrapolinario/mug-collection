import type { HttpResponseInit } from '@azure/functions'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export const json = (jsonBody: unknown, status = 200): HttpResponseInit => ({ status, jsonBody })

export function errorResponse(error: unknown): HttpResponseInit {
  if (error instanceof HttpError) return json({ message: error.message }, error.status)
  return json({ message: 'An unexpected error occurred.' }, 500)
}