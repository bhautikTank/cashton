import { createClient } from "@/src/lib/supabase/server";
import { prisma } from "@/src/lib/prisma";
import type { RegisterInput, LoginInput } from "@/src/lib/validations/auth.schema";
import { sendWelcomeEmail } from "@/src/lib/notifications/email.service";

export async function register(input: RegisterInput) {
  const supabase = await createClient();

  // 1. Check if user already exists in Prisma database by email or mobile number
  const existingEmail = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingEmail) {
    return {
      success: false,
      status: 409,
      message: "An account with this email already exists",
    };
  }

  const existingMobile = await prisma.user.findUnique({
    where: { mobileNumber: input.mobileNumber },
  });

  if (existingMobile) {
    return {
      success: false,
      status: 409,
      message: "An account with this mobile number already exists",
    };
  }

  // 2. Sign up user via Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        name: input.name,
        mobileNumber: input.mobileNumber,
      },
    },
  });

  if (error) {
    return {
      success: false,
      status: 400,
      message: error.message || "Unable to register with these details",
    };
  }

  if (!data.user) {
    return {
      success: false,
      status: 400,
      message: "Registration could not be completed",
    };
  }

  // Supabase returns an empty identities array if the user was already registered
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      success: false,
      status: 409,
      message: "An account with this email already exists",
    };
  }

  // 3. Create or reconcile the Prisma application profile and wallet
  // Strictly enforce server-controlled role: USER (never accept role from input)
  try {
    const profile = await prisma.user.upsert({
      where: { authUserId: data.user.id },
      create: {
        authUserId: data.user.id,
        email: input.email,
        name: input.name,
        mobileNumber: input.mobileNumber,
        role: "USER",
        wallet: {
          create: {
            balance: 0.00,
          },
        },
      },
      update: {
        name: input.name,
        email: input.email,
        mobileNumber: input.mobileNumber,
      },
    });

    // Ensure wallet exists if user was updated rather than created
    await prisma.wallet.upsert({
      where: { userId: profile.id },
      create: { userId: profile.id, balance: 0.00 },
      update: {},
    });

    // Send welcome email asynchronously (non-blocking)
    sendWelcomeEmail({ email: profile.email, name: profile.name }).catch(() => {});

    return {
      success: true,
      status: 201,
      message: data.session
        ? "Registration successful"
        : "Please check your email to verify your account",
      requiresEmailVerification: !data.session,
      user: {
        id: profile.id,
        authUserId: profile.authUserId,
        email: profile.email,
        name: profile.name,
        mobileNumber: profile.mobileNumber,
        role: profile.role,
      },
    };
  } catch (dbError) {
    console.error("Failed to synchronize Prisma user profile:", dbError);
    // Clear session to prevent orphaned authentication state
    await supabase.auth.signOut().catch(() => {});
    return {
      success: false,
      status: 500,
      message: "Account created but failed to initialize user profile",
    };
  }
}

export async function login(input: LoginInput) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error || !data.user) {
    return {
      success: false,
      status: 401,
      message: error?.message || "Invalid email or password",
    };
  }

  // Fetch or ensure application profile exists
  let profile = await prisma.user.findUnique({
    where: { authUserId: data.user.id },
  });

  if (!profile) {
    // Reconcile profile if user was created directly in Supabase
    profile = await prisma.user.create({
      data: {
        authUserId: data.user.id,
        email: data.user.email ?? input.email,
        name: (data.user.user_metadata?.name as string) ?? null,
        mobileNumber: (data.user.user_metadata?.mobileNumber as string) ?? null,
        role: "USER",
        wallet: {
          create: {
            balance: 0.00,
          },
        },
      },
    });
  } else {
    // Ensure wallet exists
    await prisma.wallet.upsert({
      where: { userId: profile.id },
      create: { userId: profile.id, balance: 0.00 },
      update: {},
    });
  }

  return {
    success: true,
    status: 200,
    message: "Login successful",
    user: {
      id: profile.id,
      authUserId: profile.authUserId,
      email: profile.email,
      name: profile.name,
      mobileNumber: profile.mobileNumber,
      role: profile.role,
    },
  };
}

export async function logout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return {
      success: false,
      status: 500,
      message: error.message || "Logout failed",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Logged out successfully",
  };
}
