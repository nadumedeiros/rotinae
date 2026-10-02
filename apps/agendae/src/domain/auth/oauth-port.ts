import type { Session, UserRole } from './types';

export type GoogleAuthorizationInput = {
  authorizationCode: string;
  redirectUri: string;
  codeVerifier: string;
  selectedRole: UserRole;
  termsConsent: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: string;
    source: 'web' | 'android' | 'ios';
  };
};

/** Troca e validação acontecem no servidor; o client secret nunca vai para o app. */
export interface OAuthPort {
  exchangeGoogleAuthorization(input: GoogleAuthorizationInput): Promise<Session>;
}
