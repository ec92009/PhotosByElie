import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const sourceFor = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Could not isolate ${start}`);
  return source.slice(startIndex, endIndex);
};

const evaluate = (source, sandbox, expression) => {
  sandbox.window = sandbox.window || sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\nglobalThis.__result = ${expression};`, sandbox);
  return sandbox.__result;
};

const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const pageSandbox = ({ href, config }) => ({
  URL,
  URLSearchParams,
  localStorage: storage(),
  location: new URL(href),
  photosByElieMediaConfig: config,
});

test("basket and order ignore public worker overrides but allow localhost overrides", () => {
  const config = {
    authWorkerBaseUrl: "https://auth.photos-by-elie.com",
    checkoutWorkerBaseUrl: "https://checkout.photos-by-elie.com",
  };
  const basketHelpers = between(sourceFor("basket.js"), "const normalizedWorkerBase", "const escapeText");
  assert.match(sourceFor("basket.js"), /fetch\(`\$\{checkoutRequestBaseUrl\(path\)\}\$\{path\}`/);
  const orderHelpers = between(sourceFor("order.js"), "const normalizedWorkerBase", "const currentParams");

  const publicBasket = pageSandbox({
    href: "https://photos-by-elie.com/basket.html?workerBase=https://attacker.example",
    config,
  });
  publicBasket.workerBaseKey = "photosbyelie-worker-base";
  assert.equal(
    JSON.stringify(evaluate(basketHelpers, publicBasket, "[workerBaseUrl(), accountCheckoutWorkerBaseUrl(), checkoutRequestBaseUrl('/checkout/guest'), checkoutRequestBaseUrl('/checkout/account')]")),
    JSON.stringify([config.checkoutWorkerBaseUrl, config.authWorkerBaseUrl, config.checkoutWorkerBaseUrl, config.authWorkerBaseUrl]),
  );

  const localBasket = pageSandbox({
    href: "http://localhost:8000/basket.html?workerBase=http://dev-worker.test:8787",
    config,
  });
  localBasket.workerBaseKey = "photosbyelie-worker-base";
  assert.equal(
    JSON.stringify(evaluate(basketHelpers, localBasket, "[workerBaseUrl(), accountCheckoutWorkerBaseUrl()]")),
    JSON.stringify(["http://dev-worker.test:8787", "http://dev-worker.test:8787"]),
  );

  const splitLocalBasket = pageSandbox({
    href: "http://localhost:8000/basket.html?workerBase=http://dev-worker.test:8787&authWorkerBase=http://dev-auth.test:8788",
    config,
  });
  splitLocalBasket.workerBaseKey = "photosbyelie-worker-base";
  assert.equal(
    JSON.stringify(evaluate(basketHelpers, splitLocalBasket, "[checkoutRequestBaseUrl('/checkout/guest'), checkoutRequestBaseUrl('/checkout/account')]")),
    JSON.stringify(["http://dev-worker.test:8787", "http://dev-auth.test:8788"]),
  );

  const publicOrder = pageSandbox({
    href: "https://photos-by-elie.com/order.html?workerBase=https://attacker.example&authWorkerBase=https://attacker-auth.example",
    config,
  });
  publicOrder.params = new URLSearchParams(publicOrder.location.search);
  publicOrder.workerBaseKey = "photosbyelie-worker-base";
  assert.equal(
    JSON.stringify(evaluate(orderHelpers, publicOrder, "[workerBaseUrl(), orderAccountWorkerBaseUrl()]")),
    JSON.stringify([config.checkoutWorkerBaseUrl, config.authWorkerBaseUrl]),
  );

  const localOrder = pageSandbox({
    href: "http://127.0.0.1:8000/order.html?workerBase=http://dev-worker.test:8787&authWorkerBase=http://dev-auth.test:8788",
    config,
  });
  localOrder.params = new URLSearchParams(localOrder.location.search);
  localOrder.workerBaseKey = "photosbyelie-worker-base";
  assert.equal(
    JSON.stringify(evaluate(orderHelpers, localOrder, "[workerBaseUrl(), orderAccountWorkerBaseUrl()]")),
    JSON.stringify(["http://dev-worker.test:8787", "http://dev-auth.test:8788"]),
  );
});

test("account and Real Estate use configured origins publicly and local overrides on loopback", () => {
  const config = {
    authWorkerBaseUrl: "https://auth.photos-by-elie.com",
    checkoutWorkerBaseUrl: "https://checkout.photos-by-elie.com",
  };
  const accountHelpers = between(sourceFor("photos.js"), "const normalizedAccountWorkerBase", "const accountReturnUrl");
  const realEstateHelpers = between(sourceFor("real-estate.js"), "  const normalizedWorkerBase", "  const workerMediaUrl");

  const accountBaseFor = (href, local) => {
    const sandbox = pageSandbox({ href, config });
    sandbox.photosByElieInputMode = { isLocalhost: () => local };
    return evaluate(accountHelpers, sandbox, "accountWorkerBaseUrl()");
  };
  assert.equal(
    accountBaseFor("https://photos-by-elie.com/?authWorkerBase=https://attacker.example", false),
    config.authWorkerBaseUrl,
  );
  assert.equal(
    accountBaseFor("http://localhost:8000/?authWorkerBase=http://dev-auth.test:8788", true),
    "http://dev-auth.test:8788",
  );

  const realEstateBaseFor = (href, isLocalHost) => {
    const sandbox = pageSandbox({ href, config });
    sandbox.pageParams = new URLSearchParams(sandbox.location.search);
    sandbox.isLocalHost = isLocalHost;
    return evaluate(realEstateHelpers, sandbox, "workerBaseUrl()");
  };
  assert.equal(
    realEstateBaseFor("https://photos-by-elie.com/real-estate.html?workerBase=https://attacker.example", false),
    config.authWorkerBaseUrl,
  );
  assert.equal(
    realEstateBaseFor("http://localhost:8000/real-estate.html?workerBase=http://dev-worker.test:8787", true),
    "http://dev-worker.test:8787",
  );
});
