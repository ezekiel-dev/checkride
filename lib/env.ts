import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),

    NEXT_PUBLIC_BOOKING_URL: optionalUrl,
    BETTER_AUTH_SECRET: optionalString,
    BETTER_AUTH_URL: optionalUrl,

    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    GITHUB_TOKEN: optionalString,

    GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
    AI_MODEL: optionalString,
    AI_DAILY_CALL_LIMIT: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),

    UPSTASH_REDIS_REST_URL: optionalUrl,
    UPSTASH_REDIS_REST_TOKEN: optionalString,

    INNGEST_EVENT_KEY: optionalString,
    INNGEST_SIGNING_KEY: optionalString,

    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    STRIPE_PRICE_ID_FULL_REPORT: optionalString,

    RESEND_API_KEY: optionalString,
    EMAIL_FROM: optionalString,

    SENTRY_DSN: optionalString,
    SENTRY_AUTH_TOKEN: optionalString,
  })
  .superRefine((env, ctx) => {
    // Upstash and Inngest are optional outside production (in-memory rate
    // limiting and the Inngest dev server cover local development). In
    // production they are required; the build phase is exempt so `next build`
    // does not need live credentials.
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.NEXT_PHASE === "phase-production-build"
    ) {
      return;
    }
    for (const key of [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when NODE_ENV=production`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${details}`);
  }

  cached = parsed.data;
  return cached;
}
