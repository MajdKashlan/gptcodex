import { HttpContextToken } from '@angular/common/http';

/** Prevents the interceptor from appending an API-token Authorization header. */
export const SKIP_ERP_NEXT_AUTH = new HttpContextToken<boolean>(() => false);

/** Prevents login failures from triggering the global unauthorized redirect. */
export const SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER = new HttpContextToken<boolean>(
  () => false,
);
