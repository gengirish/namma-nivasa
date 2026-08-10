/**
 * The single response shape for every route handler under app/api.
 * A handler parses, authorizes, delegates to lib/, and shapes the result into this union.
 * Nothing else.
 */
export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };
