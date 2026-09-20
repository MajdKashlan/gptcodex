export interface ApiTokenCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface PasswordCredentials {
  username: string;
  password: string;
}

export type AuthenticationMode = 'anonymous' | 'api-token' | 'session';

export interface AuthState {
  mode: AuthenticationMode;
  user: string | null;
}

export interface ErpNextMessageResponse<T> {
  message: T;
}

export interface ErpNextLoginResponse {
  message: string;
  full_name?: string;
  home_page?: string;
}
