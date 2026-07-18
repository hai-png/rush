import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { identityService } from '@addis/api/modules/identity/service';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  providers: [
    Credentials({
      credentials: { phone: {}, password: {} },
      async authorize(creds, req) {
        const ip = req.headers.get('x-forwarded-for') ?? undefined;
        const ua = req.headers.get('user-agent') ?? undefined;
        try {
          const { user, accessToken } = await identityService.login(creds.phone as string, creds.password as string, ua, ip);
          // Store our own signed JWT as the NextAuth token payload — single source of truth.
          return { id: user.id, role: user.role, phone: user.phone, accessToken };
        } catch {
          return null; // NextAuth maps this to a generic auth failure
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
