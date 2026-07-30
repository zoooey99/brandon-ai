import Twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

function getClient() {
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw new Error("Missing Twilio environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID)");
  }
  return Twilio(accountSid, authToken);
}

export async function sendVerificationCode(phone: string): Promise<{ success: boolean; error?: string }> {
  // Test mode bypass — skip Twilio entirely
  if (process.env.NODE_ENV === "test") {
    return { success: true };
  }

  try {
    const client = getClient();
    const verification = await client.verify.v2
      .services(verifyServiceSid!)
      .verifications.create({ to: phone, channel: "sms" });

    if (verification.status === "pending") {
      return { success: true };
    }
    return { success: false, error: "Failed to send verification code" };
  } catch (err: any) {
    // Rate limit: too many requests for this phone number
    if (err.code === 60203) {
      return { success: false, error: "Too many attempts. Please wait a few minutes before trying again." };
    }
    console.error("Twilio sendVerificationCode error:", err);
    return { success: false, error: "Failed to send verification code" };
  }
}

export async function checkVerificationCode(phone: string, code: string): Promise<{ verified: boolean; error?: string }> {
  // Test mode bypass — accept magic code "000000"
  if (process.env.NODE_ENV === "test" && code === "000000") {
    return { verified: true };
  }

  try {
    const client = getClient();
    const check = await client.verify.v2
      .services(verifyServiceSid!)
      .verificationChecks.create({ to: phone, code });

    if (check.status === "approved") {
      return { verified: true };
    }
    return { verified: false, error: "Invalid code. Please try again." };
  } catch (err: any) {
    // 404 means the verification has expired or doesn't exist
    if (err.status === 404) {
      return { verified: false, error: "Code expired. Please request a new one." };
    }
    console.error("Twilio checkVerificationCode error:", err);
    return { verified: false, error: "Verification failed. Please try again." };
  }
}
