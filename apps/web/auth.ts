import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { identityService } from '@addis/api/modules/identity/service';
import { TwoFactorRequiredError } from '@addis/shared';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  providers: [
    Credentials({
      credentials: { phone: {}, password: {}, code: {} },
      async authorize(creds, req) {

        const xff = req.headers.get('x-forwarded-for');
        let ip: string | undefined;
        if (xff) {
          const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) ip = parts[parts.length - 1] ?? undefined;
        }
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

          return { id: user.id, role: user.role, phone: user.phone, accessToken };
        } catch (err) {
          if (err instanceof TwoFactorRequiredError) {

            throw new Error('TwoFactorRequired');
          }
          return null;
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
