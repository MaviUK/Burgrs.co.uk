import { createClient } from "npm:@supabase/supabase-js@2";
import { cert, getApps, initializeApp } from "npm:firebase-admin/app";
import { getMessaging } from "npm:firebase-admin/messaging";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function normalizePrivateKey(raw: string) {
  let value = String(raw || "").trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.private_key) value = String(parsed.private_key);
    } catch {
      // Keep the original value so the validation below produces a clear error.
    }
  }

  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .trim();
}

function firebaseApp() {
  if (getApps().length) return getApps()[0];

  const projectId = Deno.env.get("FIREBASE_PROJECT_ID") || "";
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL") || "";
  const privateKey = normalizePrivateKey(Deno.env.get("FIREBASE_PRIVATE_KEY") || "");

  if (!projectId || !clientEmail || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Firebase service account configuration is invalid");
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST required" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const suppliedSecret = req.headers.get("x-burgrs-show-notifications-secret") || "";

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: allowed, error: secretError } = await admin.rpc(
      "validate_show_notifications_secret",
      { p_secret: suppliedSecret }
    );
    if (secretError) throw secretError;
    if (!allowed) return json(401, { error: "Unauthorized" });

    const requestBody = await req.json().catch(() => ({}));

    if (requestBody?.test_push === true) {
      const username = String(requestBody?.username || "Mavi").trim();
      const testTitle = String(requestBody?.title || "BURGRS test push").slice(0, 200);
      const testBody = String(
        requestBody?.body || "Push notifications are working on this device."
      ).slice(0, 500);
      const testType = String(requestBody?.type || "test_push").slice(0, 100);
      const testUrl = String(requestBody?.url || "/notifications").slice(0, 1000);
      const testNotificationId = String(
        requestBody?.notification_id || "test-push"
      ).slice(0, 200);

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id, username")
        .ilike("username", username)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) return json(404, { error: "Push test user not found" });

      const { data: devices, error: deviceError } = await admin
        .from("push_devices")
        .select("token, platform")
        .eq("user_id", profile.id)
        .eq("enabled", true);

      if (deviceError) throw deviceError;

      const tokens = (devices || [])
        .filter((device: any) => device.platform === "android" && device.token)
        .map((device: any) => device.token);

      if (!tokens.length) {
        return json(200, {
          ok: true,
          test: true,
          username: profile.username,
          push_sent: 0,
          push_failed: 0,
          reason: "no_active_android_device",
        });
      }

      const result = await getMessaging(firebaseApp()).sendEachForMulticast({
        tokens,
        notification: {
          title: testTitle,
          body: testBody,
        },
        data: {
          notificationId: testNotificationId,
          type: testType,
          url: testUrl,
        },
        android: { priority: "high" },
      });

      const errors = result.responses
        .map((response: any, index: number) =>
          response.success
            ? null
            : {
                index,
                code: response.error?.code || "unknown",
                message: response.error?.message || "Unknown FCM error",
              }
        )
        .filter(Boolean);

      if (errors.length) console.error("Test push failures", errors);

      return json(200, {
        ok: result.successCount > 0,
        test: true,
        username: profile.username,
        push_sent: result.successCount,
        push_failed: result.failureCount,
        errors,
      });
    }

    const [
      { data: showRows, error: processError },
      { data: recommendationRows, error: recommendationError },
      { data: newsRows, error: newsError },
      { data: platformRows, error: platformError },
      { data: reviewRows, error: reviewError },
    ] = await Promise.all([
      admin.rpc("process_show_notification_events"),
      admin.rpc("process_recommendation_notifications"),
      admin.rpc("process_tv_news_notifications"),
      admin.rpc("process_show_platform_notifications"),
      admin.rpc("process_review_notifications"),
    ]);
    if (processError) throw processError;
    if (recommendationError) throw recommendationError;
    if (newsError) throw newsError;
    if (platformError) throw platformError;
    if (reviewError) throw reviewError;

    const notifications = [
      ...(Array.isArray(showRows) ? showRows : []),
      ...(Array.isArray(recommendationRows) ? recommendationRows : []),
      ...(Array.isArray(newsRows) ? newsRows : []),
      ...(Array.isArray(platformRows) ? platformRows : []),
      ...(Array.isArray(reviewRows) ? reviewRows : []),
    ];

    let sent = 0;
    let failed = 0;
    let skippedNoDevice = 0;

    for (const item of notifications) {
      const { data: devices, error: deviceError } = await admin
        .from("push_devices")
        .select("token, platform")
        .eq("user_id", item.recipient_user_id)
        .eq("enabled", true);

      if (deviceError) throw deviceError;

      const tokens = (devices || [])
        .filter((device: any) => device.platform === "android" && device.token)
        .map((device: any) => device.token);

      if (!tokens.length) {
        skippedNoDevice += 1;
        continue;
      }

      try {
        const notificationType = String(item.notification_type || "");
        const isAiringToday = notificationType === "airing_today";
        const rawTitle = String(item.notification_title || "BURGRS");
        const rawBody = String(item.notification_body || "You have a new notification.");
        const pushTitle = isAiringToday
          ? rawTitle.replace(/\s+airs today$/i, "").trim() || rawTitle
          : rawTitle;
        const pushBody = isAiringToday
          ? `Airs today\n${rawBody}`
          : rawBody;

        const result = await getMessaging(firebaseApp()).sendEachForMulticast({
          tokens,
          notification: {
            title: pushTitle,
            body: pushBody,
          },
          data: {
            notificationId: String(item.notification_id),
            type: notificationType,
            url: String(item.notification_url || "/notifications"),
          },
          android: { priority: "high" },
        });

        sent += result.successCount;
        failed += result.failureCount;

        if (result.failureCount > 0) {
          console.error("FCM multicast failures", {
            notificationId: item.notification_id,
            failureCount: result.failureCount,
            errors: result.responses
              .map((response: any, index: number) =>
                response.success
                  ? null
                  : {
                      index,
                      code: response.error?.code || "unknown",
                      message: response.error?.message || "Unknown FCM error",
                    }
              )
              .filter(Boolean),
          });
        }
      } catch (pushError) {
        failed += tokens.length;
        console.error("FCM send failed", {
          notificationId: item.notification_id,
          error: pushError instanceof Error ? pushError.message : String(pushError),
        });
      }
    }

    return json(200, {
      ok: true,
      notifications_created: notifications.length,
      push_sent: sent,
      push_failed: failed,
      push_skipped_no_device: skippedNoDevice,
    });
  } catch (error) {
    console.error(error);
    return json(500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
