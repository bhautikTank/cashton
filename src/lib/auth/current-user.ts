import { createClient } from "@/src/lib/supabase/server";
import { prisma } from "@/src/lib/prisma";

export async function getCurrentAuthUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function getCurrentUser() {
  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return null;
  }

  const profile = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
  });

  return {
    auth: authUser,
    profile,
  };
}
