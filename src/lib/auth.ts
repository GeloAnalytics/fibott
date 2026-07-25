import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import type { Role, AccountStatus } from "@/generated/prisma/enums";

class EmailNotVerifiedError extends CredentialsSignin {
  code = "EMAIL_NOT_VERIFIED";
}

class AccountSuspendedError extends CredentialsSignin {
  code = "ACCOUNT_SUSPENDED";
}

class InvalidCredentialsError extends CredentialsSignin {
  code = "INVALID_CREDENTIALS";
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) throw new InvalidCredentialsError();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) throw new InvalidCredentialsError();

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) throw new InvalidCredentialsError();

        if (!user.emailVerified) throw new EmailNotVerifiedError();
        if (user.status === "SUSPENDED") throw new AccountSuspendedError();

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          status: user.status,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  events: {
    async createUser({ user }) {
      // OAuth-created accounts arrive with a Google-verified email; trust it immediately.
      if (user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: new Date() },
        });
      }
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: user.email } });
        if (dbUser?.status === "SUSPENDED") return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.status = user.status;
      } else if (token.id) {
        // Keep role/status reasonably fresh across the JWT's lifetime.
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.status = dbUser.status;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.status = token.status as AccountStatus;
      }
      return session;
    },
  },
});
