import { createClient } from "@supabase/supabase-js";
import { installSmartShowLinks } from "./smartShowLinks";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const MY_SHOWS_CACHE_PREFIX = "trackt_my_shows_cache_v1";
const DASHBOARD_CACHE_PREFIX = "trackt_dashboard_cache_v6_SAVED_SHOW_ID_LINKS";

function clearStoredShowCaches() {
  if (typeof window === "undefined") return;

  try {
    const keysToRemove = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;

      if (
        key.startsWith(`${MY_SHOWS_CACHE_PREFIX}:`) ||
        key.startsWith(`${DASHBOARD_CACHE_PREFIX}:`)
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch (error) {
    console.warn("Failed clearing stored show caches:", error);
  }
}

function wrapUserShowsMutation(builder) {
  return new Proxy(builder, {
    get(target, property) {
      if (property === "then") {
        return (onFulfilled, onRejected) =>
          target.then((result) => {
            if (!result?.error) clearStoredShowCaches();
            return onFulfilled ? onFulfilled(result) : result;
          }, onRejected);
      }

      const value = Reflect.get(target, property, target);

      if (typeof value !== "function") return value;

      return (...args) => {
        const result = value.apply(target, args);
        return result && typeof result === "object"
          ? wrapUserShowsMutation(result)
          : result;
      };
    },
  });
}

function wrapUserShowsRead(builder, selectedColumns = "") {
  const includesWatchStatus = String(selectedColumns).includes("watch_status");

  return new Proxy(builder, {
    get(target, property) {
      const value = Reflect.get(target, property, target);

      if (property === "maybeSingle" && typeof value === "function") {
        return (...args) => {
          const result = value.apply(target, args);

          if (!includesWatchStatus) return result;

          return result.then((response) => {
            if (response?.error || response?.data) return response;

            return {
              ...response,
              data: {
                id: null,
                user_id: null,
                show_id: null,
                watch_status: "not_added",
                archived_at: null,
                added_at: null,
                created_at: null,
              },
            };
          });
        };
      }

      if (typeof value !== "function") return value;

      return (...args) => {
        const result = value.apply(target, args);
        return result && typeof result === "object"
          ? wrapUserShowsRead(result, selectedColumns)
          : result;
      };
    },
  });
}

const client = createClient(supabaseUrl, supabaseAnonKey);
const originalFrom = client.from.bind(client);

client.from = (table) => {
  const builder = originalFrom(table);

  if (table !== "user_shows_new") return builder;

  return new Proxy(builder, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      const operation = String(property);
      const isMutation = ["insert", "upsert", "update", "delete"].includes(
        operation
      );

      if (isMutation && typeof value === "function") {
        return (...args) => wrapUserShowsMutation(value.apply(target, args));
      }

      if (property === "select" && typeof value === "function") {
        return (...args) =>
          wrapUserShowsRead(value.apply(target, args), args[0] || "*");
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

let lastSystemAdminSyncUserId = "";

async function syncSystemAdminDefaults(session) {
  const userId = session?.user?.id || "";
  if (!userId || userId === lastSystemAdminSyncUserId) return;

  lastSystemAdminSyncUserId = userId;

  try {
    const { error } = await client.rpc("ensure_burgers_tv_defaults");
    if (error) throw error;
  } catch (error) {
    lastSystemAdminSyncUserId = "";
    console.warn("Failed syncing BURGRS system admin defaults:", error);
  }
}

if (typeof window !== "undefined") {
  client.auth
    .getSession()
    .then(({ data }) => syncSystemAdminDefaults(data?.session || null))
    .catch((error) => {
      console.warn("Failed loading session for BURGRS system admin sync:", error);
    });

  client.auth.onAuthStateChange((_event, session) => {
    if (!session?.user?.id) {
      lastSystemAdminSyncUserId = "";
      return;
    }

    void syncSystemAdminDefaults(session);
  });
}

installSmartShowLinks(client);

export const supabase = client;
