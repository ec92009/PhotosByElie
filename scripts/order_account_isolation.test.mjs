import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const orderSource = fs.readFileSync(new URL("../order.js", import.meta.url), "utf8");

class FakeClassList {
  add() {}
  remove() {}
  toggle() {}
  contains() { return false; }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.href = "";
    this.innerHTML = "";
    this.listeners = new Map();
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append() {}
  closest() { return null; }
  focus() {}
  insertAdjacentHTML(_position, html) { this.innerHTML += html; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  replaceChildren() { this.innerHTML = ""; this.textContent = ""; }
  select() {}

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
    if (name === "href") this.href = "";
  }

  setAttribute(name, value = "") {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
    if (name === "href") this.href = String(value);
  }
}

const readyOrder = {
  id: "order-one",
  status: "ready",
  buyerEmail: "buyer@example.com",
  amountExpected: 100,
  amountPaid: 100,
  currency: "usd",
  checkoutMode: "account",
  items: [{
    photoId: "photo-one",
    title: "Photo One",
    collection: "Collection",
    products: [{ id: "full", label: "Full", amount: 100 }],
  }],
  delivery: {
    files: [{
      photoId: "photo-one",
      productId: "full",
      name: "photo-one.jpg",
      downloadUrl: "/download/token-one",
      bytes: 10,
      contentType: "image/jpeg",
    }],
  },
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const runOrderPage = async ({ search, checkoutState, accountOrderStatus = 403 }) => {
  const selectors = new Map();
  const selectorNames = [
    "[data-order-heading]",
    "[data-order-phase]",
    "[data-order-message]",
    "[data-order-details]",
    "[data-order-items]",
    "[data-order-status]",
    "[data-download-zip]",
    "[data-copy-zip-path]",
    "[data-zip-copy-field]",
    "[data-zip-location]",
    "[data-order-refresh]",
    "[data-embedded-browser-warning]",
    "[data-open-browser-link]",
    "[data-copy-browser-link]",
    "[data-order-lookup]",
    "[data-order-lookup-id]",
    "[data-order-lookup-email]",
  ];
  selectorNames.forEach((selector) => selectors.set(selector, new FakeElement()));
  selectors.get("[data-order-details]").innerHTML = "stale private order details";
  selectors.get("[data-order-items]").innerHTML = "stale private delivery controls";
  selectors.get("[data-download-zip]").hidden = false;
  selectors.get("[data-download-zip]").setAttribute("href", "/stale-private-download");
  const stateSteps = ["pending_payment", "preparing", "ready"].map((state) => {
    const element = new FakeElement();
    element.dataset.stateStep = state;
    return element;
  });
  const fetchCalls = [];
  const location = new URL(`https://photos-by-elie.com/order.html${search}`);
  const document = {
    body: new FakeElement(),
    documentElement: { lang: "en" },
    execCommand: () => false,
    querySelector: (selector) => selectors.get(selector) || null,
    querySelectorAll: (selector) => selector === "[data-state-step]" ? stateSteps : [],
  };
  const storage = new Map([["photosbyelie-mock-checkout", JSON.stringify(checkoutState)]]);
  const sandbox = {
    Blob,
    Intl,
    Response,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    crypto,
    document,
    fetch: async (input) => {
      const url = new URL(String(input));
      fetchCalls.push(url);
      if (url.pathname === "/account/orders/order-one") {
        return accountOrderStatus === 200
          ? jsonResponse({ order: readyOrder })
          : jsonResponse({ error: { message: "This order is not attached to the signed-in account." } }, accountOrderStatus);
      }
      if (url.pathname === "/account/profile") {
        return jsonResponse({ profile: { email: "buyer@example.com" }, orders: [readyOrder] });
      }
      if (url.pathname === "/orders/order-one") return jsonResponse({ order: readyOrder });
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    location,
    navigator: {},
    setTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.clearTimeout = clearTimeout;
  sandbox.photosByElieI18n = { t: (key) => key };
  sandbox.photosByElieMediaConfig = {
    authWorkerBaseUrl: "https://auth.photos-by-elie.com",
    checkoutWorkerBaseUrl: "https://checkout.example.test",
  };
  sandbox.setTimeout = setTimeout;

  vm.runInNewContext(orderSource, sandbox, { filename: "order.js" });
  await settle();
  return { fetchCalls, selectors };
};

test("account order denial never falls back to a checkout email cached by another account", async () => {
  const { fetchCalls, selectors } = await runOrderPage({
    search: "?id=order-one&account=1",
    checkoutState: { orderId: "order-one", email: "buyer@example.com" },
    accountOrderStatus: 403,
  });

  assert.deepEqual(fetchCalls.map((url) => url.pathname), ["/account/orders/order-one"]);
  assert.equal(selectors.get("[data-order-heading]").textContent, "order.unavailable");
  assert.equal(selectors.get("[data-order-details]").innerHTML, "");
  assert.equal(selectors.get("[data-order-items]").innerHTML, "");
  assert.equal(selectors.get("[data-download-zip]").hidden, true);
  assert.equal(selectors.get("[data-download-zip]").href, "");
  assert.equal(selectors.get("[data-order-lookup]").hidden, true);
});

test("account order denial ignores an explicit guest email credential in the account URL", async () => {
  const { fetchCalls } = await runOrderPage({
    search: "?id=order-one&account=1&email=buyer%40example.com",
    checkoutState: {},
    accountOrderStatus: 403,
  });

  assert.deepEqual(fetchCalls.map((url) => url.pathname), ["/account/orders/order-one"]);
});

test("account order success still loads the order and account history", async () => {
  const { fetchCalls, selectors } = await runOrderPage({
    search: "?id=order-one&account=1",
    checkoutState: { orderId: "order-one", email: "buyer@example.com" },
    accountOrderStatus: 200,
  });

  assert.deepEqual(fetchCalls.map((url) => url.pathname), [
    "/account/orders/order-one",
    "/account/profile",
  ]);
  assert.equal(selectors.get("[data-order-heading]").textContent, "order.ready_download");
  assert.match(selectors.get("[data-order-items]").innerHTML, /data-download-file="0"/);
});

test("guest recovery can still use checkout email from local state outside account mode", async () => {
  const { fetchCalls, selectors } = await runOrderPage({
    search: "?id=order-one",
    checkoutState: { orderId: "order-one", email: "buyer@example.com" },
  });

  assert.deepEqual(fetchCalls.map((url) => url.pathname), ["/orders/order-one"]);
  assert.equal(selectors.get("[data-order-heading]").textContent, "order.ready_download");
});
