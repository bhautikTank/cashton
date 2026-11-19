import { prisma } from "@/src/lib/prisma";
import type { UpdateProfileInput } from "@/src/lib/validations/user.schema";

export interface UserProfileResponse {
  id: string;
  name: string | null;
  email: string;
  mobileNumber: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export function sanitizeProfile(user: {
  id: string;
  name: string | null;
  email: string;
  mobileNumber: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}): UserProfileResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mobileNumber: user.mobileNumber,
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
      mobileNumber: true,
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
  const data: { name?: string; mobileNumber?: string } = {};

  if (input.name !== undefined) {
    data.name = input.name;
  }

  if (input.mobileNumber !== undefined) {
    data.mobileNumber = input.mobileNumber;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      mobileNumber: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
}
