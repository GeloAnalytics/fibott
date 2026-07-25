import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;

  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    if (role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
  }

  if (pathname.startsWith("/dashboard")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    if (role === "ADMIN") {
      return NextResponse.redirect(new URL("/admin", req.nextUrl));
    }
  }
});

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
