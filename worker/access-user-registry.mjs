const SCHEMA = "photosbyelie.accessUser.v1";
const VALID_TIERS = new Set(["user", "re_client", "owner"]);
const GRANTABLE_ROLES = new Set(["owner", "re_client"]);
const FIXTURE_PEOPLE = [
  {
    email: "alex.rivera@example.test",
    displayName: "Alex Rivera",
    tier: "user",
    notes: "Fixture regular user for ACS role-assignment rehearsal.",
  },
  {
    email: "morgan.lee@example.test",
    displayName: "Morgan Lee",
    tier: "re_client",
    realEstateClients: ["fixture-re-gallery"],
    notes: "Fixture RE client tied to a sample gallery grant.",
  },
  {
    email: "sam.patel@example.test",
    displayName: "Sam Patel",
    tier: "owner",
    notes: "Fixture owner-style helper account for permission testing.",
  },
  {
    email: "jamie.martin@example.test",
    displayName: "Jamie Martin",
    tier: "user",
    notes: "Fixture event attendee candidate.",
  },
];
const FIXTURE_EVENTS = [
  {
    id: "fixture-family-direct-kin",
    label: "Direct kin rehearsal circle",
    kind: "family",
    accessPolicy: "private previews, downloads later",
  },
  {
    id: "fixture-event-summer-portraits",
    label: "Summer portraits rehearsal event",
    kind: "event",
    accessPolicy: "watermarked previews, paid downloads",
  },
  {
    id: "fixture-re-gallery",
    label: "Fixture real estate gallery",
    kind: "real_estate",
    accessPolicy: "PDF/video/originals for assigned RE client",
  },
];

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

const nowIso = () => new Date().toISOString();

const randomId = (prefix) => `${prefix}-${crypto.randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;

const normalizeTier = (value) => {
  const tier = String(value || "user").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return VALID_TIERS.has(tier) ? tier : "user";
};

const normalizeGalleryKeys = (value) => {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
};

const normalizeDisplayName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);

const normalizeNotes = (value) => String(value || "").trim().slice(0, 2000);

const normalizeRoleList = (record = {}) => {
  const roles = new Set();
  const source = Array.isArray(record.roles)
    ? record.roles
    : String(record.roles || "").split(/[\s,;]+/);
  source
    .map((role) => String(role || "").trim().toLowerCase().replace(/[-\s]+/g, "_"))
    .filter((role) => GRANTABLE_ROLES.has(role))
    .forEach((role) => roles.add(role));
  const tier = normalizeTier(record.tier);
  if (GRANTABLE_ROLES.has(tier)) roles.add(tier);
  return [...roles];
};

const tierForRoles = (roles = [], realEstateClients = []) => {
  const roleSet = new Set(roles);
  if (roleSet.has("owner")) return "owner";
  if (roleSet.has("re_client") || realEstateClients.length) return "re_client";
  return "user";
};

export const normalizeAccessUserRecord = (record = {}, fallbackEmail = "") => {
  const email = normalizeEmail(record.email || fallbackEmail);
  if (!validEmail(email)) return null;
  const grantableRoles = normalizeRoleList(record);
  const realEstateClients = normalizeGalleryKeys(
    record.realEstateClients || record.realEstateGalleries || record.galleryKeys || record.galleryKey
  );
  const disabledAt = record.disabledAt || record.disabled_at || null;
  return {
    schema: SCHEMA,
    email,
    displayName: normalizeDisplayName(record.displayName || record.display_name || record.name),
    tier: disabledAt ? "user" : tierForRoles(grantableRoles, realEstateClients),
    roles: disabledAt ? ["user"] : ["user", ...grantableRoles],
    realEstateClients: disabledAt ? [] : realEstateClients,
    notes: normalizeNotes(record.notes),
    source: String(record.source || "").trim() || (record.fixture ? "fixture" : "manual"),
    fixture: record.fixture === true || record.fixture === 1 || record.fixture === "1",
    disabledAt,
    disabledBy: String(record.disabledBy || record.disabled_by || "").trim(),
    grantedBy: String(record.grantedBy || record.granted_by || "").trim(),
    grantedAt: record.grantedAt || record.granted_at || null,
    updatedAt: record.updatedAt || record.updated_at || null,
  };
};

const fixtureEvents = () => FIXTURE_EVENTS.map((event) => ({ ...event, fixture: true }));

export const createMemoryAccessUserRegistry = (initialRecords = []) => {
  const users = new Map();
  const auditEvents = [];
  const events = new Map();
  initialRecords
    .map((record) => normalizeAccessUserRecord(record))
    .filter(Boolean)
    .forEach((record) => users.set(record.email, record));

  const audit = (eventType, actorEmail, targetEmail, before, after) => {
    const event = {
      id: randomId("access-audit"),
      eventType,
      actorEmail: normalizeEmail(actorEmail),
      targetEmail: normalizeEmail(targetEmail),
      before,
      after,
      createdAt: nowIso(),
    };
    auditEvents.unshift(event);
    return clone(event);
  };

  const getUser = async (email) => clone(users.get(normalizeEmail(email))) || null;

  const listUsers = async () => [...users.values()]
    .map(clone)
    .sort((left, right) => String(left.email).localeCompare(String(right.email)));

  const putUser = async (record, options = {}) => {
    const normalized = normalizeAccessUserRecord(record);
    if (!normalized) throw new Error("Access user record requires a valid email address.");
    const before = await getUser(normalized.email);
    const timestamp = nowIso();
    const after = {
      ...normalized,
      grantedBy: normalized.grantedBy || options.actorEmail || "",
      grantedAt: normalized.grantedAt || timestamp,
      updatedAt: timestamp,
    };
    users.set(after.email, clone(after));
    audit("user_upserted", options.actorEmail || after.grantedBy || "", after.email, before, after);
    return clone(after);
  };

  const disableUser = async (email, options = {}) => {
    const normalizedEmail = normalizeEmail(email);
    const before = await getUser(normalizedEmail);
    if (!before) return null;
    const after = normalizeAccessUserRecord({
      ...before,
      disabledAt: nowIso(),
      disabledBy: options.actorEmail || "",
      updatedAt: nowIso(),
    });
    users.set(normalizedEmail, clone(after));
    audit("user_disabled", options.actorEmail || "", normalizedEmail, before, after);
    return clone(after);
  };

  const seedFixtureData = async (options = {}) => {
    for (const person of FIXTURE_PEOPLE) {
      const email = normalizeEmail(person.email);
      if (!users.has(email)) await putUser({ ...person, fixture: true, source: "fixture" }, options);
    }
    for (const event of FIXTURE_EVENTS) {
      if (!events.has(event.id)) events.set(event.id, { ...event, fixture: true });
    }
    return {
      users: (await listUsers()).filter((user) => user.fixture),
      events: await listFixtureEvents(),
    };
  };

  const listFixtureEvents = async () => [...events.values()].length
    ? [...events.values()].map(clone)
    : fixtureEvents();

  return {
    getUser,
    listUsers,
    putUser,
    disableUser,
    seedFixtureData,
    listFixtureEvents,
    listAuditEvents: async (limit = 25) => auditEvents.slice(0, limit).map(clone),
    _debug: { users, events, auditEvents },
  };
};

export const createKvAccessUserRegistry = ({
  namespace,
  prefix = "pbe",
} = {}) => {
  if (!namespace) throw new Error("createKvAccessUserRegistry requires a KV namespace binding.");
  const keyFor = (email) => `${prefix}:access-users:${normalizeEmail(email)}`;

  const getUser = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!validEmail(normalizedEmail)) return null;
    const value = await namespace.get(keyFor(normalizedEmail), { type: "json" });
    return normalizeAccessUserRecord(value || {}, normalizedEmail);
  };

  const putUser = async (record, options = {}) => {
    const normalized = normalizeAccessUserRecord({
      ...record,
      grantedBy: record.grantedBy || options.actorEmail || "",
      grantedAt: record.grantedAt || nowIso(),
      updatedAt: nowIso(),
    });
    if (!normalized) throw new Error("Access user record requires a valid email address.");
    await namespace.put(keyFor(normalized.email), JSON.stringify(normalized));
    return clone(normalized);
  };

  const listUsers = async () => {
    if (typeof namespace.list !== "function") return [];
    const users = [];
    let cursor = "";
    do {
      const page = await namespace.list({ prefix: `${prefix}:access-users:`, limit: 1000, cursor });
      for (const key of page.keys || []) {
        const email = String(key.name || "").slice(`${prefix}:access-users:`.length);
        const user = await getUser(email);
        if (user) users.push(user);
      }
      cursor = page.list_complete ? "" : page.cursor || "";
    } while (cursor);
    return users.sort((left, right) => left.email.localeCompare(right.email));
  };

  return {
    getUser,
    putUser,
    listUsers,
    disableUser: async (email, options = {}) => {
      const existing = await getUser(email);
      if (!existing) return null;
      return putUser({
        ...existing,
        disabledAt: nowIso(),
        disabledBy: options.actorEmail || "",
      }, options);
    },
    seedFixtureData: async (options = {}) => {
      for (const person of FIXTURE_PEOPLE) {
        if (!await getUser(person.email)) await putUser({ ...person, fixture: true, source: "fixture" }, options);
      }
      return {
        users: await listUsers(),
        events: fixtureEvents(),
      };
    },
    listFixtureEvents: async () => fixtureEvents(),
    listAuditEvents: async () => [],
  };
};

const d1All = async (statement) => {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
};

const d1First = async (statement) => {
  if (typeof statement.first === "function") return statement.first();
  const rows = await d1All(statement);
  return rows[0] || null;
};

const d1Run = async (statement) => statement.run();

const roleRowsFor = async (database, email = "") => d1All(
  database.prepare("SELECT role FROM pbe_access_role_grants WHERE email = ? AND state = 'active' ORDER BY role").bind(email)
);

const galleryRowsFor = async (database, email = "") => d1All(
  database.prepare("SELECT gallery_key FROM pbe_access_gallery_grants WHERE email = ? AND gallery_kind = 'real_estate' AND state = 'active' ORDER BY gallery_key").bind(email)
);

const recordFromD1Rows = (person, roleRows = [], galleryRows = []) => {
  if (!person) return null;
  return normalizeAccessUserRecord({
    email: person.email,
    displayName: person.display_name,
    roles: roleRows.map((row) => row.role),
    realEstateClients: galleryRows.map((row) => row.gallery_key),
    notes: person.notes,
    source: person.source,
    fixture: person.fixture,
    disabledAt: person.disabled_at,
    disabledBy: person.disabled_by,
    grantedBy: person.created_by,
    grantedAt: person.created_at,
    updatedAt: person.updated_at,
  });
};

const auditD1 = async (database, { eventType, actorEmail, targetEmail, before, after }) => d1Run(
  database.prepare(`
    INSERT INTO pbe_access_audit_events (
      id, event_type, actor_email, target_email, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    randomId("access-audit"),
    String(eventType || "access_change"),
    normalizeEmail(actorEmail),
    normalizeEmail(targetEmail),
    JSON.stringify(before || null),
    JSON.stringify(after || null),
    nowIso()
  )
);

export const createD1AccessUserRegistry = ({
  database,
} = {}) => {
  if (!database) throw new Error("createD1AccessUserRegistry requires a D1 database binding.");

  const getPerson = async (email) => d1First(
    database.prepare("SELECT * FROM pbe_access_people WHERE email = ?").bind(normalizeEmail(email))
  );

  const getUser = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!validEmail(normalizedEmail)) return null;
    const person = await getPerson(normalizedEmail);
    if (!person) return null;
    const [roles, galleries] = await Promise.all([
      roleRowsFor(database, normalizedEmail),
      galleryRowsFor(database, normalizedEmail),
    ]);
    return recordFromD1Rows(person, roles, galleries);
  };

  const putUser = async (record, options = {}) => {
    const normalized = normalizeAccessUserRecord(record);
    if (!normalized) throw new Error("Access user record requires a valid email address.");
    const before = await getUser(normalized.email);
    const actorEmail = normalizeEmail(options.actorEmail || normalized.grantedBy || "");
    const timestamp = nowIso();
    await d1Run(database.prepare(`
      INSERT INTO pbe_access_people (
        email, display_name, source, fixture, notes, disabled_at, disabled_by,
        created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        source = excluded.source,
        fixture = excluded.fixture,
        notes = excluded.notes,
        disabled_at = excluded.disabled_at,
        disabled_by = excluded.disabled_by,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).bind(
      normalized.email,
      normalized.displayName,
      normalized.source || "manual",
      normalized.fixture ? 1 : 0,
      normalized.notes,
      normalized.disabledAt,
      normalized.disabledBy,
      timestamp,
      actorEmail,
      timestamp,
      actorEmail
    ));

    const roles = new Set(normalizeRoleList(normalized));
    for (const role of GRANTABLE_ROLES) {
      if (roles.has(role)) {
        await d1Run(database.prepare(`
          INSERT INTO pbe_access_role_grants (
            id, email, role, state, granted_at, granted_by, updated_at, updated_by
          ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
          ON CONFLICT(email, role) DO UPDATE SET
            state = 'active',
            revoked_at = NULL,
            revoked_by = '',
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `).bind(randomId("role-grant"), normalized.email, role, timestamp, actorEmail, timestamp, actorEmail));
      } else {
        await d1Run(database.prepare(`
          UPDATE pbe_access_role_grants
          SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
          WHERE email = ? AND role = ? AND state = 'active'
        `).bind(timestamp, actorEmail, timestamp, actorEmail, normalized.email, role));
      }
    }

    const wantedGalleries = new Set(normalized.realEstateClients);
    const existingGalleries = await galleryRowsFor(database, normalized.email);
    for (const row of existingGalleries) {
      if (!wantedGalleries.has(row.gallery_key)) {
        await d1Run(database.prepare(`
          UPDATE pbe_access_gallery_grants
          SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
          WHERE email = ? AND gallery_kind = 'real_estate' AND gallery_key = ? AND state = 'active'
        `).bind(timestamp, actorEmail, timestamp, actorEmail, normalized.email, row.gallery_key));
      }
    }
    for (const galleryKey of wantedGalleries) {
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_gallery_grants (
          id, email, gallery_kind, gallery_key, state, granted_at, granted_by, updated_at, updated_by
        ) VALUES (?, ?, 'real_estate', ?, 'active', ?, ?, ?, ?)
        ON CONFLICT(email, gallery_kind, gallery_key) DO UPDATE SET
          state = 'active',
          revoked_at = NULL,
          revoked_by = '',
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(randomId("gallery-grant"), normalized.email, galleryKey, timestamp, actorEmail, timestamp, actorEmail));
    }

    const after = await getUser(normalized.email);
    await auditD1(database, { eventType: "user_upserted", actorEmail, targetEmail: normalized.email, before, after });
    return after;
  };

  const listUsers = async () => {
    const people = await d1All(database.prepare("SELECT * FROM pbe_access_people ORDER BY fixture DESC, email ASC"));
    const users = [];
    for (const person of people) {
      const [roles, galleries] = await Promise.all([
        roleRowsFor(database, person.email),
        galleryRowsFor(database, person.email),
      ]);
      const record = recordFromD1Rows(person, roles, galleries);
      if (record) users.push(record);
    }
    return users;
  };

  const disableUser = async (email, options = {}) => {
    const normalizedEmail = normalizeEmail(email);
    const before = await getUser(normalizedEmail);
    if (!before) return null;
    const actorEmail = normalizeEmail(options.actorEmail || "");
    const timestamp = nowIso();
    await d1Run(database.prepare(`
      UPDATE pbe_access_people
      SET disabled_at = ?, disabled_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ?
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    await d1Run(database.prepare(`
      UPDATE pbe_access_role_grants
      SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ? AND state = 'active'
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    await d1Run(database.prepare(`
      UPDATE pbe_access_gallery_grants
      SET state = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?, updated_by = ?
      WHERE email = ? AND state = 'active'
    `).bind(timestamp, actorEmail, timestamp, actorEmail, normalizedEmail));
    const after = await getUser(normalizedEmail);
    await auditD1(database, { eventType: "user_disabled", actorEmail, targetEmail: normalizedEmail, before, after });
    return after;
  };

  const seedFixtureData = async (options = {}) => {
    for (const person of FIXTURE_PEOPLE) {
      if (!await getPerson(person.email)) {
        await putUser({ ...person, fixture: true, source: "fixture" }, options);
      }
    }
    const timestamp = nowIso();
    const actorEmail = normalizeEmail(options.actorEmail || "");
    for (const event of FIXTURE_EVENTS) {
      await d1Run(database.prepare(`
        INSERT INTO pbe_access_fixture_events (
          id, label, kind, access_policy, fixture, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label = excluded.label,
          kind = excluded.kind,
          access_policy = excluded.access_policy,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(event.id, event.label, event.kind, event.accessPolicy, timestamp, actorEmail, timestamp, actorEmail));
    }
    return {
      users: (await listUsers()).filter((user) => user.fixture),
      events: await listFixtureEvents(),
    };
  };

  const listFixtureEvents = async () => d1All(database.prepare(`
    SELECT id, label, kind, access_policy AS accessPolicy, fixture
    FROM pbe_access_fixture_events
    ORDER BY kind, label
  `));

  const listAuditEvents = async (limit = 25) => d1All(database.prepare(`
    SELECT
      id,
      event_type AS eventType,
      actor_email AS actorEmail,
      target_email AS targetEmail,
      before_json AS beforeJson,
      after_json AS afterJson,
      created_at AS createdAt
    FROM pbe_access_audit_events
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(100, Number(limit) || 25))));

  return {
    getUser,
    putUser,
    listUsers,
    disableUser,
    seedFixtureData,
    listFixtureEvents,
    listAuditEvents,
  };
};
