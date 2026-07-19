import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { identityService } from '@addis/api/modules/identity/service';
import { TwoFactorRequiredError } from '@addis/shared';

/**
 * NextAuth Credentials provider, bridged to the API's identityService.login().
 *
 * Two-factor auth: identityService.login() throws TwoFactorRequiredError when the user
 * has 2FA enabled (mandatory for platform_admin and corporate_admin per
 * TWO_FA_REQUIRED_ROLES). Previously this catch block swallowed that error and
 * returned null, so 2FA-enabled users saw a generic "Invalid credentials"
 * message and could not log in via the web app at all.
 *
 * We now surface TwoFactorRequiredError back to the client via a stable error
 * code on the signIn() result (`error: 'TwoFactorRequired'`) so the login page
 * can redirect to a 2FA-code entry step. The actual code is then passed back
 * through `credentials.code` on the second signIn() call, which
 * identityService.login() forwards to otplib's authenticator.check().
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  providers: [
    Credentials({
      credentials: { phone: {}, password: {}, code: {} },
      async authorize(creds, req) {
        const ip = req.headers.get('x-forwarded-for') ?? undefined;
        const ua = req.headers.get('user-agent') ?? undefined;
        try {
          const code = (creds.code as string | undefined)?.trim() || undefined;
          const { user, accessToken } = await identityService.login(
            creds.phone as string,
            creds.password as string,
            ua,
            ip,
            code,
          );
          // Store our own signed JWT as the NextAuth token payload — single
          // source of truth. The accessToken is the API's jose-signed JWT;
          // getServerApiClient reads it back via auth().
          return { id: user.id, role: user.role, phone: user.phone, accessToken };
        } catch (err) {
          if (err instanceof TwoFactorRequiredError) {
            // Throwing here lets NextAuth surface the specific error code to
            // the client via
            // `signIn('credentials', { ..., redirect: false }).error === 'TwoFactorRequired'`.
            throw new Error('TwoFactorRequired');
          }
          return null; // any other auth failure → generic "Invalid credentials"
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.accessToken = (user as any).accessToken; token.role = (user as any).role; }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).role = token.role;
      return session;
    },
  },
  cookies: {
    sessionToken: { name: '__Secure-session-token', options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' } },
  },
});
