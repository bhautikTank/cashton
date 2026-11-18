import { prisma } from "@/src/lib/prisma";
import type { UpdateProfileInput } from "@/src/lib/validations/user.schema";

export interface UserProfileResponse {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export function sanitizeProfile(user: {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}): UserProfileResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function getProfile(
  userId: string
): Promise<UserProfileResponse | null> {
  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return profile;
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<UserProfileResponse> {
  // Service-level enforcement: strictly updates only the name field
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
}
