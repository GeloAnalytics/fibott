import type { DefaultSession } from "next-auth";
import type { Role, AccountStatus } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role: Role;
    status: AccountStatus;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      status: AccountStatus;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    status: AccountStatus;
  }
}
