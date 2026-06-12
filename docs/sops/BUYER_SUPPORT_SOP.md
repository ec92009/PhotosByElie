# PhotosByElie Buyer Support SOP

Use this SOP when a buyer emails `orders@photos-by-elie.com` for checkout, payment, order recovery, expired download links, duplicate charges, or missing delivery files.

The support rule is simple: Stripe is the payment authority. The Photos By Elie Worker is the delivery authority. Do not refresh or send download links until a paid Stripe record and the Photos By Elie order record agree, or until the owner explicitly approves a manual exception.

## Inputs To Parse From The Email

Start by extracting these fields from the customer email. Copy exact values; do not retype from memory.

| Field | Pattern | Example |
| --- | --- | --- |
| Order ID | `PBE-YYYYMMDD-XXXXXXXXXX` | `PBE-20260531-D359A3A26E` |
| Checkout email | email address | `buyer@example.com` |
| Stripe Checkout session | `cs_live_...` or `cs_test_...` | `cs_live_b1...` |
| Site status | free text after `Status shown on site:` | `pending_payment` |
| Expected/paid total | money amount | `$0.50` |
| Discount details | code and amount | `OWNER-LIVE-REHEARSAL`, `$64.50` |
| Selected files | photo title, photo ID, collection, product | `JPG 1 MP` |
| Support/order URL | `support.html` or `order.html` URL | `https://photos-by-elie.com/order.html?...` |

If the email includes a `localhost` URL, treat it as diagnostic context only. Never send a customer a `localhost` recovery link.

## First Response Posture

If the email says the site status is `pending_payment`, say you need to verify Stripe before refreshing delivery. `pending_payment` means the Worker/order page has not confirmed payment. It does not prove Stripe is unpaid.

Use this holding reply when useful:

```text
Hello,

Thanks for sending the order details. The order page shows pending payment, so I need to verify the Stripe checkout session before refreshing delivery.

I am checking this Stripe reference:
<STRIPE_CHECKOUT_SESSION>

If Stripe confirms payment, I will refresh the order delivery and send the download recovery link. If Stripe does not show a completed payment, I will let you know what Stripe shows and what to try next.

Thank you,
Photos By Elie Support
```

## Step 1: Check The Photos By Elie Worker Order

Use the production Worker as the order/delivery ledger:

```bash
curl -sS 'https://photosbyelie-checkout-mock.ec92009.workers.dev/orders/<ORDER_ID>?email=<URL_ENCODED_CHECKOUT_EMAIL>' | python3 -m json.tool
```

If there is a Stripe Checkout session but no order ID, use:

```bash
curl -sS 'https://photosbyelie-checkout-mock.ec92009.workers.dev/orders/by-session/<STRIPE_CHECKOUT_SESSION>' | python3 -m json.tool
```

Record:

- `order.id`
- `order.status`
- `order.buyerEmail`
- `order.originalSubtotalAmount`
- `order.discountCode`
- `order.discountAmount`
- `order.amountExpected`
- `order.amountPaid`
- `order.items`
- `order.delivery`
- `order.deliveryError`
- `order.stripe.checkoutSessionId`
- `order.stripe.paymentIntentId`
- `order.createdAt`, `paidAt`, and `updatedAt`

Worker status meanings:

| Worker status | Meaning | Support action |
| --- | --- | --- |
| `pending_payment` | Order draft exists, no verified paid webhook yet. | Check Stripe before sending anything. |
| `preparing` | Payment was accepted; delivery is being built. | Wait/retry shortly; escalate if stuck. |
| `ready` | Delivery exists. | Send the production recovery link. |
| `delivery_failed` | Payment likely succeeded but delivery failed. | Escalate; do not promise files until the delivery error is fixed. |
| `unknown_order` | Worker has no order by that ID/email. | Search Stripe by session/email; ask customer for receipt if needed. |

## Order Stats From Worker KV

For store/product analytics, use the Cloudflare Worker KV namespace as the order ledger. The namespace id is in `wrangler.toml` under the `ORDERS_KV` binding. Order keys use the `KV_PREFIX` plus `orders`, currently `pbe:orders:<ORDER_ID>`.

Prefer the Cloudflare REST API for full listings; `wrangler kv key list` can be misleading in token/remote-context edge cases. Required environment:

```bash
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<api-token-with-kv-read>
```

Use this one-off Python pattern from the repo root to enumerate order records and aggregate products/media. Do not print buyer emails in summaries unless doing a specific support investigation.

```bash
python3 - <<'PY'
import collections, json, os, urllib.parse, urllib.request

account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
namespace = "0ea4d21c491246c986c2c0308bebc560"
headers = {"Authorization": f"Bearer {token}"}

def api_json(path):
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}{path}",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

keys = []
cursor = ""
while True:
    params = {"prefix": "pbe:orders:", "limit": "1000"}
    if cursor:
        params["cursor"] = cursor
    payload = api_json(
        f"/storage/kv/namespaces/{namespace}/keys?{urllib.parse.urlencode(params)}"
    )
    keys.extend(item["name"] for item in payload.get("result") or [])
    cursor = (payload.get("result_info") or {}).get("cursor") or ""
    if not cursor:
        break

orders = []
for key in keys:
    encoded = urllib.parse.quote(key, safe="")
    orders.append(api_json(f"/storage/kv/namespaces/{namespace}/values/{encoded}"))

def checkout_kind(order):
    session = str(order.get("checkoutSessionId") or order.get("stripe", {}).get("checkoutSessionId") or "")
    if session.startswith("cs_live_"):
        return "live"
    if session.startswith("cs_mock_"):
        return "mock"
    return "other"

def paid_or_ready(order):
    return order.get("status") == "ready" or int(order.get("amountPaid") or 0) > 0

product_counts = collections.Counter()
media_counts = {}
for order in orders:
    if checkout_kind(order) != "live" or not paid_or_ready(order):
        continue
    for item in order.get("items") or []:
        record = media_counts.setdefault(item.get("photoId"), {
            "title": item.get("title") or "",
            "collection": item.get("collectionTitle") or item.get("collection") or "",
            "orders": set(),
            "products": collections.Counter(),
        })
        record["orders"].add(order.get("id"))
        for product in item.get("products") or []:
            product_id = product.get("id") or "unknown"
            product_counts[product_id] += 1
            record["products"][product_id] += 1

print("Live paid/ready product counts:")
print(dict(product_counts))
print("Live paid/ready media counts:")
for photo_id, record in sorted(media_counts.items(), key=lambda row: (-len(row[1]["orders"]), row[0])):
    print(photo_id, len(record["orders"]), record["title"], record["collection"], dict(record["products"]))
PY
```

Useful slices:

- Live paid/ready demand: `checkout_kind(order) == "live"` and `paid_or_ready(order)`.
- Live abandoned checkout demand: `checkout_kind(order) == "live"` and `order.status == "pending_payment"`.
- All paid/ready test coverage: `paid_or_ready(order)` regardless of checkout kind. This includes mock and early non-Stripe test records, so label it as test coverage rather than sales.
- Product-line counts answer "what products were selected." Distinct order counts per media ID answer "which photos/videos were bought or attempted how many times."

When the owner asks for the recurring media/product table, include live Stripe attempts, group by media ID, omit buyer email, and show each selected product with the historical amount actually paid for that line. Use `$0.00` for pending/unpaid checkout attempts so abandoned demand remains visible without implying revenue.

```bash
python3 - <<'PY'
import collections, json, os, urllib.parse, urllib.request

account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
namespace = "0ea4d21c491246c986c2c0308bebc560"
headers = {"Authorization": f"Bearer {token}"}

def api_json(path):
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}{path}",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

keys = []
cursor = ""
while True:
    params = {"prefix": "pbe:orders:", "limit": "1000"}
    if cursor:
        params["cursor"] = cursor
    payload = api_json(
        f"/storage/kv/namespaces/{namespace}/keys?{urllib.parse.urlencode(params)}"
    )
    keys.extend(item["name"] for item in payload.get("result") or [])
    cursor = (payload.get("result_info") or {}).get("cursor") or ""
    if not cursor:
        break

def checkout_kind(order):
    session = str(order.get("checkoutSessionId") or order.get("stripe", {}).get("checkoutSessionId") or "")
    if session.startswith("cs_live_"):
        return "live"
    if session.startswith("cs_mock_"):
        return "mock"
    return "other"

def paid_or_ready(order):
    return order.get("status") == "ready" or int(order.get("amountPaid") or 0) > 0

def money(cents):
    return f"${cents / 100:.2f}"

rows = {}
for key in keys:
    encoded = urllib.parse.quote(key, safe="")
    order = api_json(f"/storage/kv/namespaces/{namespace}/values/{encoded}")
    if checkout_kind(order) != "live":
        continue
    order_paid = paid_or_ready(order)
    for item in order.get("items") or []:
        photo_id = item.get("photoId") or "(missing)"
        record = rows.setdefault(photo_id, {
            "title": item.get("title") or "",
            "lines": [],
        })
        for product in item.get("products") or []:
            record["lines"].append({
                "product": product.get("id") or "unknown",
                "paidCents": int(product.get("checkoutAmount", product.get("amount") or 0) or 0) if order_paid else 0,
            })

print("| Photo/media ID | Title | Products and paid price |")
print("| --- | --- | --- |")
for photo_id, record in sorted(
    rows.items(),
    key=lambda row: (
        -sum(1 for line in row[1]["lines"] if line["paidCents"] > 0),
        -len(row[1]["lines"]),
        row[0],
    ),
):
    compact = collections.Counter((line["product"], line["paidCents"]) for line in record["lines"])
    parts = []
    for (product_id, cents), count in sorted(compact.items(), key=lambda row: (row[0][0], -row[0][1])):
        suffix = f" x{count}" if count > 1 else ""
        parts.append(f"`{product_id}` {money(cents)}{suffix}")
    print(f"| `{photo_id}` | {record['title']} | {'; '.join(parts)} |")
PY
```

## Step 2: Check Stripe

In Stripe Dashboard:

1. Search the exact `cs_live_...` or `cs_test_...` value.
2. If that fails, search the order ID.
3. If that fails, search the checkout email.
4. If the session starts with `cs_live_`, make sure Stripe is in live mode. If it starts with `cs_test_`, use test mode.

Confirm:

- Checkout Session or PaymentIntent exists.
- Payment status is `paid` / payment intent is `succeeded`.
- Amount and currency match the Worker `amountExpected`.
- For owner rehearsal purchases, Worker `originalSubtotalAmount`, `discountCode`, `discountAmount`, `amountExpected`, and Stripe amount/metadata agree.
- Customer email matches or reasonably explains the support email.
- Metadata or description links to the same PBE order ID.
- Payment is not refunded, disputed, or failed.

If Stripe search by email shows a different successful PBE order, do not silently swap orders. Tell the customer which paid order was found and that the requested order remains pending/unpaid.

## Step 3: Reconcile Worker And Stripe

Use this table to decide what to do.

| Worker result | Stripe result | Action |
| --- | --- | --- |
| Order `ready`; Stripe paid | Normal recovery. Send order link. |
| Order `pending_payment`; Stripe paid for same session/order | Resend the `checkout.session.completed` webhook in Stripe, then recheck Worker. |
| Order `pending_payment`; Stripe has no matching paid record | Do not send downloads. Ask for Stripe receipt/payment proof. |
| Order `pending_payment`; Stripe email search finds a different paid PBE order | Send recovery link for the paid order and explain the requested order is pending. |
| Worker order missing; Stripe paid with PBE metadata | Use Stripe metadata to find/recreate investigation context; escalate before manual delivery. |
| Worker `delivery_failed`; Stripe paid | Escalate with `deliveryError`; fix delivery before replying with links. |
| Download expired/limit reached; Worker `ready`; Stripe paid | Refresh/regenerate delivery links if supported, or escalate to owner/manual delivery. |

## Step 4: Send The Right Link

For a verified paid and ready order, send the production order recovery URL:

```text
https://photos-by-elie.com/order.html?id=<ORDER_ID>&email=<URL_ENCODED_CHECKOUT_EMAIL>
```

Do not send raw Worker `/download/...` token links unless the owner explicitly approves. The order page is the buyer-facing delivery record.

## Customer Reply Templates

### Paid And Ready

```text
Hello,

Thanks for sending the order details. I verified the payment and found the Photos By Elie delivery record for order <ORDER_ID>.

You can recover your download here:
https://photos-by-elie.com/order.html?id=<ORDER_ID>&email=<URL_ENCODED_CHECKOUT_EMAIL>

Purchased file(s):
<SHORT_ITEM_SUMMARY>

Thank you,
Photos By Elie Support
```

### Worker Pending, Stripe Not Paid Or Not Found

```text
Hello,

Thanks for sending the order details. I found order <ORDER_ID> in the Photos By Elie order system, but it is still marked pending payment and has no download delivery attached.

I could not find a completed Stripe payment for the Stripe reference shown on that order:
<STRIPE_CHECKOUT_SESSION>

If you believe this order was paid, please search your email, including spam or junk, for a receipt with this subject:

Your Photos By Elie receipt

Please forward that receipt email, or send the exact payment details, including payment date/time, checkout email, card brand, and last 4 digits. Once I can verify a completed payment, I will recover the download delivery.

Thank you,
Photos By Elie Support
```

### Different Paid Order Found

```text
Hello,

Thanks for sending the order details. I found the order you mentioned, <REQUESTED_ORDER_ID>, but it is still marked pending payment and has no delivery links.

I did find a separate successful Photos By Elie payment under your email for this paid order:
<PAID_ORDER_ID>

You can recover that paid order here:
https://photos-by-elie.com/order.html?id=<PAID_ORDER_ID>&email=<URL_ENCODED_CHECKOUT_EMAIL>

If you believe <REQUESTED_ORDER_ID> was also paid, please search your email, including spam or junk, for a receipt with this subject:

Your Photos By Elie receipt

Please forward that receipt email and I will investigate further.

Thank you,
Photos By Elie Support
```

### Paid In Stripe, Worker Still Pending

```text
Hello,

Thanks for the details. I found a completed Stripe payment for order <ORDER_ID>, but the Photos By Elie delivery record has not finished updating yet.

I am refreshing the checkout delivery now. I will send the recovery link as soon as the order page shows the files are ready.

Thank you,
Photos By Elie Support
```

After resending the Stripe webhook and confirming `ready`, send the Paid And Ready reply.

## Escalation Checklist

Escalate before promising delivery when:

- Stripe and Worker disagree and webhook resend does not fix it.
- Worker status is `delivery_failed`.
- Stripe payment amount/currency does not match Worker `amountExpected`.
- The customer email does not match the order email and the customer cannot prove receipt ownership.
- The requested product file is missing from R2/private delivery.
- There is a refund, dispute, duplicate charge, or suspicious mismatch.

Include in the escalation note:

- Original customer email.
- Extracted order ID, checkout email, Stripe session, amount, and site status.
- Worker lookup JSON summary.
- Stripe lookup summary.
- What reply, if any, was already sent.

## Safety Rules

- Never send private files or download links for an unpaid order.
- Never rely only on the customer's screenshot/email if Stripe and Worker do not confirm payment.
- Never send `localhost` URLs to customers.
- Prefer the public `order.html?id=...&email=...` recovery link over raw token URLs.
- Treat Stripe receipts as payment records and Photos By Elie order pages as delivery/recovery records.
