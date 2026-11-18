import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth/current-user";
import { UserRole } from "@/src/generated/prisma/enums";
import type { User as PrismaUser } from "@/src/generated/prisma/client";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

export interface AuthenticatedUserSession {
  auth: SupabaseAuthUser;
  profile: PrismaUser;
}

export type AuthResult =
  | { success: true; data: AuthenticatedUserSession }
  | { success: false; response: NextResponse };

/**
 * Ensures the caller is authenticated with a valid Supabase session
 * AND has an existing, trusted application profile in the Prisma database.
 */
export async function requireAuth(): Promise<AuthResult> {
  const user = await getCurrentUser();

  if (!user || !user.auth) {
    return {
      success: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  if (!user.profile) {
    return {
      success: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: User profile not found" },
        { status: 401 }
      ),
    };
  }

  return {
    success: true,
    data: {
      auth: user.auth,
      profile: user.profile,
    },
  };
}

/**
 * Checks whether the user's trusted server-side profile role
 * matches any of the allowed roles.
 */
export function hasRole(role: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(role);
}

/**
 * Convenience helper to check if role has admin-level access (ADMIN or SUPER_ADMIN).
 */
export function isAdminRole(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

/**
 * Ensures the caller is authenticated AND their server-side database role
 * matches one of the specified allowed roles.
 *
 * Never trusts request body, query parameters, headers, or client metadata.
 */
export async function requireRole(
  allowedRoles: UserRole[]
): Promise<AuthResult> {
  const authResult = await requireAuth();

  if (!authResult.success) {
    return authResult;
  }

  const { profile } = authResult.data;

  if (!hasRole(profile.role, allowedRoles)) {
    return {
      success: false,
      response: NextResponse.json(
        {
          success: false,
          message: "Forbidden: You do not have permission to access this resource",
        },
        { status: 403 }
      ),
    };
  }

  return authResult;
}

/**
 * Helper to require admin-level privileges (ADMIN or SUPER_ADMIN).
 */
export async function requireAdmin(): Promise<AuthResult> {
  return requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
}
