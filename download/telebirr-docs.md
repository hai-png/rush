# Telebirr Developer Documentation — Implementation Reference

> Source: https://developer.ethiotelecom.et/docs
> Fetched and consolidated for Node.js/TypeScript backend implementation.
> All field names are reproduced exactly as Telebirr documents them (mostly snake_case, with some camelCase exceptions noted).

---

## Table of Contents

1. [Integration Type Comparison](#1-integration-type-comparison)
2. [Common Concepts (all integrations)](#2-common-concepts-all-integrations)
3. [Base URLs & Environment](#3-base-urls--environment)
4. [Credentials & Environment Variables](#4-credentials--environment-variables)
5. [Auth Mechanism](#5-auth-mechanism)
6. [Signature Algorithm (SHA256withRSA / PSS)](#6-signature-algorithm-sha256withrsa--pss)
7. [Integration A — InApp SDK](#7-integration-a--inapp-sdk)
8. [Integration B — H5 C2B Web Payment](#8-integration-b--h5-c2b-web-payment)
9. [Integration C — Subscription (Schedule) Payment](#9-integration-c--subscription-schedule-payment)
10. [Webhook / Notify Reference](#10-webhook--notify-reference)
11. [Refunds](#11-refunds)
12. [Gotchas, Quirks & Doc Inconsistencies](#12-gotchas-quirks--doc-inconsistencies)
13. [Reference Node.js/TypeScript Implementation](#13-reference-nodejstypescript-implementation)

---

## 1. Integration Type Comparison

| Aspect | InApp SDK | H5 C2B Web | Subscription (Schedule) Payment |
|---|---|---|---|
| **Use case** | Native Android/iOS app payments; user pays inside the Telebirr SuperApp launched from your mobile app | Web browser checkout; customer pays via phone-number+PIN or QR scan on a Telebirr-hosted payment page | Recurring/subscription billing; customer signs a one-time mandate, then merchant pulls funds (PIN-free) on schedule |
| **Who initiates each payment** | User (interactive) | User (interactive) | Merchant (server-initiated deduction) |
| **Front-end required** | Yes — Telebirr Android/iOS SDK (`EthiopiaPaySdkModule-*.aar`) | No — just redirect user's browser to a generated URL | Mini-app or H5 page for the *signing* step only; deductions are pure backend API calls |
| **Order create endpoint** | `POST /payment/v1/inapp/createOrder` | `POST /payment/v1/merchant/preOrder` | `POST /payment/v1/merchant/disburseOrder` (named `payment.disbursement`) |
| **Returns `prepay_id`** | Yes (+ `receiveCode` for SDK) | Yes | No — returns `payment_order_id` directly |
| **Mandate/contract required** | No | No | Yes — customer must sign a mandate via Telebirr app first |
| **Refund endpoint** | Not explicitly documented for InApp (H5 endpoint exists; queryOrder reports refund status) | Yes — `POST /payment/v1/merchant/refund` | Not documented |
| **Query order endpoint** | `POST /payment/v1/merchant/queryOrder` | `POST /payment/v1/merchant/queryOrder` | N/A (use notify + mandate query) |
| **Mandate management** | N/A | N/A | `POST /payment/v1/mandates/query` and `POST /payment/v1/mandateContract/cancel` |

> **When to use which:**
> - Building a native mobile app → **InApp SDK** (best UX; launches Telebirr SuperApp).
> - Building a website / PWA / web checkout → **H5 C2B Web**.
> - Charging customers on a recurring schedule without asking for PIN each time → **Subscription** (customer signs once, you charge on schedule; you implement the scheduler yourself — Telebirr only provides the PIN-free deduction capability).

---

## 2. Common Concepts (all integrations)

All three integrations share:

- **Two-layer auth:** a short-lived **Fabric Token** (`Authorization: Bearer ...` header, obtained via `/payment/v1/token`) **plus** a per-request **RSA signature** in the request body (`sign` field).
- **Identical request envelope:**
  ```json
  {
    "timestamp":  "175938855330",          // UTC seconds (string, <=13 chars)
    "nonce_str":  "...32 chars...",         // alphanumeric, no special chars
    "method":     "payment.preorder",       // fixed per endpoint
    "version":    "1.0",                    // only "1.0" supported
    "biz_content": { ... },                 // business params
    "sign":       "<base64 RSA-PSS sig>",   // 512 chars max
    "sign_type":  "SHA256WithRSA"
  }
  ```
- **Identical response envelope:**
  ```json
  {
    "result":     "SUCCESS",                // or "FAIL"
    "code":       "0",                      // "0" = success, else business error code
    "msg":        "success",
    "nonce_str":  "...",
    "sign":       "<base64 sig by SP>",
    "sign_type":  "SHA256WithRSA",
    "biz_content": { ... }
  }
  ```
- **HTTP method:** POST, `Content-Type: application/json` for every business endpoint.
- **Notify (webhook) callbacks** are sent to the `notify_url` you supplied at order-creation time. The endpoint must be **whitelisted on the SuperApp server** before it will receive callbacks.

---

## 3. Base URLs & Environment

| Environment | API Base URL (all endpoints below are appended to this) |
|---|---|
| **Testbed / Sandbox** | `https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway` |
| **Production** | `https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway` |

Both are HTTPS on port `38443`. Self-signed certs may appear in testbed — the official sample code sets `rejectUnauthorized: false` (do **not** do this in production).

**H5 web checkout Base URL (only used in H5 integration to build the user-facing redirect URL):**
- Testbed: `https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?` (note: **no** `/apiaccess/` segment, ends with `?`)
- Production: per the docs' config.js sample it is `https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway` — but this looks like a copy-paste error in the official docs (the path doesn't match the testbed shape). **Flag this with Ethio telecom before launch.** The most likely correct production value is `https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?`.

### Testbed vs Production differences
- Different host (`developerportal.ethiotelebirr.et` vs `superapp.ethiomobilemoney.et`).
- Testbed `X-APP-Key` and `appSecret` are self-service via the fabric portal.
- Production `X-APP-Key` and `appSecret` require contacting the Ethio telecom (ET) administrator.
- Telebirr recommends **separate RSA key pairs** for test vs production. You share the *public* key with ET; you keep the *private* key.
- Android InApp SDK: testbed uses `EthiopiaPaySdkModule-uat-release.aar`, production uses `EthiopiaPaySdkModule-prod-release.aar` (iOS uses the same `.aar`-named file for both, per the docs — likely another doc typo; treat as `EthiopiaPaySdkModule-release.aar` for iOS).

---

## 4. Credentials & Environment Variables

You need **all** of these for a working backend. Suggested env var names:

```bash
# Fabric (gateway) credentials — get from Ethio telecom fabric portal
TELEBIRR_X_APP_KEY=            # Fabric App ID, sent as X-APP-Key header
TELEBIRR_APP_SECRET=           # App Secret, sent in body to /payment/v1/token

# Merchant credentials — assigned by Mobile Money system
TELEBIRR_MERCHANT_APP_ID=      # a.k.a. appid / merchantAppId
TELEBIRR_MERCHANT_CODE=        # a.k.a. merch_code / shortCode (numeric, e.g. "200001")
TELEBIRR_MERCHANT_SHORT_CODE=  # used in subscription signContract step (often same as MERCHANT_CODE)

# RSA keys (PKCS#8 PEM, base64 of DER also accepted by some samples)
TELEBIRR_PRIVATE_KEY_PEM=      # your RSA private key, 2048-bit, never shared
TELEBIRR_PUBLIC_KEY_PEM=       # the public key you shared with Ethio telecom
TELEBIRR_SP_PUBLIC_KEY_PEM=    # Ethio telecom's public key, used to verify notify/response signatures

# Endpoints
TELEBIRR_BASE_URL=https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway
TELEBIRR_WEB_BASE_URL=https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?

# Mandate template (subscription only)
TELEBIRR_MANDATE_TEMPLATE_ID=  # applied for in advance from ET; daily/weekly/monthly
```

### Generating the RSA key pair (per the docs)
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private-key.pem
openssl pkey -in private-key.pem -out public-key.pem -pubout
```
Keep `private-key.pem` private. Send `public-key.pem` to Ethio telecom.

---

## 5. Auth Mechanism

### Layer 1 — Fabric Token (short-lived bearer)

`POST /payment/v1/token` (identical for all three integrations).

**Headers:**
| Header | Required | Description |
|---|---|---|
| `X-APP-Key` | Yes | Fabric App ID from the fabric portal |
| `Content-Type` | Yes | `application/json` |

**Request body:**
```json
{ "appSecret": "851bdccee2f83622658a45e3ddc40188" }
```

**Response body:**
```json
{
  "effectiveDate":   "20221101132422",   // yyyyMMddHHmmss
  "expirationDate":  "20221101142422",   // ~1 hour later
  "token":           "Bearer 94cc42be4412696d754508c06ca1db20"
}
```

> The `token` value already includes the `Bearer ` prefix. Pass it verbatim as the `Authorization` header on all subsequent business API calls. Cache it until `expirationDate`; refresh proactively (e.g. at 50 min mark of a 60-min token).

### Layer 2 — Merchant RSA signature

Every business request body contains a `sign` field (base64-encoded RSA-PSS signature, see [§6](#6-signature-algorithm-sha256withrsa--pss)). Telebirr verifies this with the public key you registered. If verification fails, the API responds `"verify sign failed"`.

### Header pattern for all business endpoints
```
POST {baseUrl}{endpoint}
Content-Type: application/json
X-APP-Key:    {TELEBIRR_X_APP_KEY}
Authorization: Bearer {token-from-/payment/v1/token}
```

---

## 6. Signature Algorithm (SHA256withRSA / PSS)

Spec from the *Development preparation* doc:
- **Algorithm:** `SHA256withRSA`
- **Fill mode (padding):** `PSS` (PKCS#1 v2.1, RSASSA-PSS with MGF1)
- **MGF1 hash:** SHA-256
- **Key size:** 2048-bit RSA
- **Output:** base64-encoded signature, ≤ 512 chars

### Fields excluded from signature
The following top-level and `biz_content` nested keys are **excluded** from signing (per official JS sample):

```
sign, sign_type, header, refund_info, openType, raw_request, biz_content, wallet_reference_data
```

Note: `biz_content` itself is excluded as a *key*, but **its inner fields are flattened and included** in the signing string. The exclusion list also applies to nested fields (so e.g. a `biz_content.raw_request` would be skipped too).

### Canonicalization algorithm

1. Take the request object (top-level keys + flattened `biz_content` keys).
2. Drop any excluded fields (`sign`, `sign_type`, `header`, `refund_info`, `openType`, `raw_request`, `biz_content`, `wallet_reference_data`).
3. Drop any field whose value is empty/null/undefined.
4. Sort remaining keys **lexicographically by ASCII code** (ascending). Case-sensitive — `A` < `Z` < `a` < `z` is *not* guaranteed; sort by raw byte value.
5. Join as `key1=value1&key2=value2&...` (no URL encoding).
6. Sign with RSA-PSS-SHA256 using your private key.
7. base64-encode the signature and put it in the `sign` field of the request body. Add `"sign_type": "SHA256WithRSA"`.

### Example `rawRequest` strings (from the docs)

**Create order:**
```
appid=1072905731584000&business_type=BuyGoods&merch_code=200001&merch_order_id=201907161732001&method=payment.preorder&nonce_str=fcab0d2949e64a69a212aa83eab6ee1d&notify_url=http://test.payment.com/notify&redirect_url=http://test.payment.com/redirect&timeout_express=120m&timestamp=1535166225&title=iphone1&total_amount=12&trade_type=Checkout&trans_currency=ETB&version=1.0
```

**Query order:**
```
appid=1072905731584000&merch_code=200001&merch_order_id=201907161732001&method=payment.queryorder&nonce_str=5K8264ILTKCH16CQ2502SI8ZNMTM67VS&timestamp=1535166225&version=1.0
```

### Reference TypeScript signing function

```ts
import crypto from "crypto";

const EXCLUDE_FIELDS = new Set([
  "sign", "sign_type", "header", "refund_info",
  "openType", "raw_request", "biz_content", "wallet_reference_data",
]);

/**
 * Build the canonical string to sign from a Telebirr request object.
 * biz_content's fields are flattened in; excluded fields are skipped.
 */
export function buildStringToSign(req: Record<string, any>): string {
  const flat: Record<string, string> = {};

  for (const [k, v] of Object.entries(req)) {
    if (EXCLUDE_FIELDS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    flat[k] = String(v);
  }

  const biz = req.biz_content;
  if (biz && typeof biz === "object") {
    for (const [k, v] of Object.entries(biz)) {
      if (EXCLUDE_FIELDS.has(k)) continue;
      if (v === undefined || v === null || v === "") continue;
      flat[k] = String(v);
    }
  }

  return Object.keys(flat)
    .sort() // ASCII ascending
    .map((k) => `${k}=${flat[k]}`)
    .join("&");
}

/** RSA-PSS / SHA256 / MGF1-SHA256 signature, base64. */
export function signTelebirr(req: Record<string, any>, privateKeyPem: string): string {
  const data = buildStringToSign(req);
  const sign = crypto.sign("sha256", Buffer.from(data, "utf8"), {
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return sign.toString("base64");
}

/** Verify an SP-signed response / notify payload. */
export function verifyTelebirr(
  payload: Record<string, any>,
  signatureBase64: string,
  spPublicKeyPem: string,
): boolean {
  const data = buildStringToSign(payload);
  return crypto.verify(
    "sha256",
    Buffer.from(data, "utf8"),
    {
      key: spPublicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    Buffer.from(signatureBase64, "base64"),
  );
}
```

> **Critical implementation note (gotcha):** the official Python sample uses `PKCS1_v1_5` (PKCS#1 v1.5 padding), which **contradicts** the Development-preparation spec (`Fill mode: PSS`) and the JS/Java/C#/PHP samples (all use PSS / MGF1). Use **PSS** — the Python sample is wrong.

---

## 7. Integration A — InApp SDK

### 7.1 Overview & flow

1. **Merchant backend** obtains a Fabric Token (`POST /payment/v1/token`).
2. **Merchant backend** calls Create Order (`POST /payment/v1/inapp/createOrder`) → receives `prepay_id` **and** `receiveCode` (a `$`-delimited string: `TELEBIRR$BUYGOODS$merch_code$total_amount$prepay_id$timeout_express`).
3. **Merchant backend** returns `receiveCode` to the **mobile app**.
4. **Mobile app** calls Telebirr SDK `PaymentManager.getInstance().pay(this, payInfo)` with `appId`, `shortCode`, `receiveCode`. The SDK opens the Telebirr SuperApp, user enters PIN, payment is processed.
5. **Telebirr** POSTs the payment result to your `notify_url`.
6. **Merchant backend** can optionally query the order via `POST /payment/v1/merchant/queryOrder`.

### 7.2 Apply Fabric Token — `POST /payment/v1/token`

See [§5 Layer 1](#layer-1--fabric-token-short-lived-bearer). Identical for all integrations.

### 7.3 Create Order — `POST /payment/v1/inapp/createOrder`

> **Doc inconsistency / gotcha:** the spec table says the endpoint is `/payment/v1/inapp/createOrder`, but the official Node.js sample code calls `config.baseUrl + "/payment/v1/merchant/inapp/createOrder"` (note the extra `/merchant/` segment). **Try the spec path first** (`/payment/v1/inapp/createOrder`); if you get a 404, fall back to `/payment/v1/merchant/inapp/createOrder`. Confirm with Ethio telecom which is canonical for your environment.

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `timestamp` | string(13) | M | UTC seconds |
| `method` | string | M | Fixed: `"payment.preorder"` |
| `nonce_str` | string(32) | M | Random alphanumeric, no special chars |
| `sign_type` | string | M | Fixed: `"SHA256WithRSA"` |
| `sign` | string(512) | M | RSA-PSS signature (see [§6](#6-signature-algorithm-sha256withrsa--pss)) |
| `version` | string(4) | M | Fixed: `"1.0"` |
| `biz_content` | object | M | See `CreateOrderBizContent` below |

**`biz_content` (CreateOrderBizContent):**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `notify_url` | string(512) | M | Webhook URL for payment notification. Must be whitelisted on SuperApp server. |
| `redirect_url` | string(512) | O | URL to return to after payment completes |
| `appid` | string(32) | M | Merchant App ID (alphanumeric only) |
| `merch_code` | string(16) | M | Merchant short code (digits, starts 1-9) |
| `merch_order_id` | string(64) | M | Merchant-generated order ID (alphanumeric + underscore only — **no other special chars**) |
| `trade_type` | string | M | For InApp use `"InApp"`. Other values: `Cross-App`, `WebCheckout`, `Checkout`, `PWA`, `QrCode`, `QuickPay`, `BankTrade` |
| `title` | string(512) | M | Order title (limited special chars: no `~\`!#$%^*()\-+=|`) |
| `total_amount` | string(20) | M | Amount as string, e.g. `"12"` or `"12.00"` (max 2 decimals) |
| `trans_currency` | string(3) | M | ISO 4217, e.g. `"ETB"` |
| `timeout_express` | string(10) | M | e.g. `"120m"`. Range 1–120 minutes; no dots; defaults to 120m |
| `business_type` | string(32) | M | Use `"BuyGoods"` |
| `payee_type` | string | O | `"3000"` = Organization Operator |
| `payee_identifier` | string | O | Merchant Code or Short Code |
| `payee_identifier_type` | string | O | `"04"` = merchant receives money via short code |

**Request example:**
```json
{
  "biz_content": {
    "appid": "1072905731584000",
    "business_type": "BuyGoods",
    "merch_code": "000000",
    "merch_order_id": "201907161732001",
    "notify_url": "http://test.payment.com/notify",
    "redirect_url": "http://test.payment.com/redirect",
    "timeout_express": "120m",
    "title": "iphone1",
    "total_amount": "12",
    "trade_type": "InApp",
    "trans_currency": "ETB",
    "payee_identifier": "200001",
    "payee_identifier_type": "04",
    "payee_type": "3000"
  },
  "method": "payment.preorder",
  "nonce_str": "fcab0d2949e64a69a212aa83eab6ee1d",
  "sign": "JYyVqFAmdgBG4n1eBQYUwNlC...",
  "sign_type": "SHA256WithRSA",
  "timestamp": "1535166225",
  "version": "1.0"
}
```

**Response `biz_content` (CreateOrderResponseInfo):**

| Field | Type | Notes |
|---|---|---|
| `merch_order_id` | string(64) | Echo of merchant order ID |
| `prepay_id` | string(128) | Payment process ID — used by SDK |
| `receiveCode` | string | **InApp-only.** Concatenated string: `TELEBIRR$BUYGOODS$merch_code$total_amount$prepay_id$timeout_express` |

**Response example:**
```json
{
  "result": "SUCCESS",
  "code": "0",
  "msg": "success",
  "nonce_str": "97fe4ae0c0604854a749fbf2cc1cc712",
  "sign": "Eo4Bvwx9rpaWAO+iYzaaXHoWBWbYcCGnVZMEcG5TPb8w...",
  "sign_type": "SHA256WithRSA",
  "biz_content": {
    "merch_order_id": "1705460512562",
    "receiveCode": "TELEBIRR$BUYGOODS$100100306$12.00$080075a4e3213924de2b3b84ad3cac0a6a6001$120m"
  }
}
```

**Error response (HTTP 405 or other non-success):**
```json
{ "errorCode": "string", "errorMsg": "string" }
```

### 7.4 Start Pay (front-end, not a backend API)

Mobile app calls the Telebirr SDK (no HTTP request from your backend):

**Android:**
```java
PayInfo payInfo = new PayInfo.Builder()
    .setAppId(appId)          // merchant appId
    .setShortCode(shortCode)  // merch_code
    .setReceiveCode(receiveCode)
    .setReturnApp(returnApp)  // optional: JSON string for return activity
    .build();
PaymentManager.getInstance().pay(this, payInfo);
```

`returnApp` JSON shape (optional):
```json
{ "activity": "<activity page path>", "packageName": "<return package name>" }
```

**Start Pay parameters:**

| Parameter | Type | M/O | Notes |
|---|---|---|---|
| `appid` | string(32) | M | Merchant App ID |
| `shortCode` | string(16) | M | Merchant short code (numeric, 1-9 leading) |
| `receiveCode` | string | M | From createOrder response |
| `returnApp` | string | O | JSON describing return page |

> iOS SDK uses the same `EthiopiaPaySdkModule-release.aar` filename in the docs — almost certainly a doc typo (should be a `.framework` or similar). Consult ET for the iOS artifact.

### 7.5 Query Order — `POST /payment/v1/merchant/queryOrder`

Use this when a notify callback is missed or to verify status. Same endpoint as H5.

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `timestamp` | string | M | UTC seconds |
| `method` | string | M | Fixed: `"payment.queryorder"` |
| `nonce_str` | string | M | ≤32 alphanumeric |
| `sign_type` | string | M | `"SHA256WithRSA"` |
| `sign` | string | M | RSA-PSS signature |
| `version` | string | M | `"1.0"` |
| `biz_content` | object | M | See below |

**`biz_content`:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `appid` | string | M | Merchant App ID |
| `merch_code` | string | M | Merchant short code |
| `merch_order_id` | string | M | Merchant order ID |

**Response `biz_content`:**

| Field | Type | Notes |
|---|---|---|
| `merch_order_id` | string(64) | Order ID on merchant side |
| `order_status` | string(3) | See `trade_status` values |
| `trade_status` | string(4) | One of: `PAY_SUCCESS`, `PAY_FAILED`, `WAIT_PAY`, `ORDER_CLOSED`, `PAYING`, `ACCEPTED`, `REFUNDING`, `REFUND_SUCCESS`, `REFUND_FAILED` |
| `payment_order_id` | string | Telebirr-side order ID |
| `trans_time` | string | e.g. `"2025-10-13 19:19:38"` |
| `trans_currency` | string | e.g. `"ETB"` |
| `total_amount` | string | e.g. `"1260.00"` |
| `trans_id` | string | Transaction ID (also appears in notify) |

**Response example:**
```json
{
  "result": "SUCCESS",
  "code": "0",
  "msg": "success",
  "nonce_str": "b93f8165b83e46a9abea4aaa7dc173a8",
  "sign": "dmeUb5r9PF9aBy6/1D54XjELYbKcCzGF6e1yxOA4/WIy1on0TpyD.....",
  "sign_type": "SHA256WithRSA",
  "biz_content": {
    "merch_order_id": "G32QWMKYLZQJ",
    "order_status": "PAY_SUCCESS",
    "payment_order_id": "11801107AD19191408215009",
    "trans_time": "2025-10-13 19:19:38",
    "trans_currency": "ETB",
    "total_amount": "1260.00",
    "trans_id": "CJD7GBOXIP"
  }
}
```

### 7.6 Notify (webhook) for InApp

See [§10](#10-webhook--notify-reference).

---

## 8. Integration B — H5 C2B Web Payment

### 8.1 Overview & flow

1. **Merchant backend** obtains a Fabric Token.
2. **Merchant backend** calls `POST /payment/v1/merchant/preOrder` → receives `prepay_id` (no `receiveCode` for H5).
3. **Merchant backend** builds a `rawRequest` string from `{appid, merch_code, nonce_str, prepay_id, timestamp, sign, sign_type=SHA256WithRSA}` and assembles the final URL: `{webBaseUrl}{rawRequest}&version=1.0&trade_type=Checkout`.
4. **Merchant backend** returns the URL to the **merchant web page**, which `window.location`-redirects the user.
5. User pays on the Telebirr-hosted page (phone number + PIN, or QR scan).
6. **Telebirr** POSTs result to `notify_url`.
7. Optionally query via `POST /payment/v1/merchant/queryOrder`.
8. Optionally refund via `POST /payment/v1/merchant/refund`.

### 8.2 Apply Fabric Token — `POST /payment/v1/token`

Identical to [§5](#layer-1--fabric-token-short-lived-bearer).

### 8.3 Create Order — `POST /payment/v1/merchant/preOrder`

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:** Same envelope as InApp (see [§7.3](#73-create-order--post-paymentv1inappcreateorder)) with these differences in `biz_content`:

| Field | Difference from InApp |
|---|---|
| `trade_type` | Use `"Checkout"` for H5 (not `"InApp"`) |
| `payee_type` | Docs sample uses `"5000"` for H5 (vs `"3000"` for InApp). Confirm with ET which applies to your merchant. |
| `callback_info` | Optional free-form string echoed back in notify (not present in InApp sample but allowed everywhere) |
| `receiveCode` | **Not returned** in H5 response — only `prepay_id` |

**Request example (H5):**
```json
{
  "biz_content": {
    "appid": "1072905731584000",
    "business_type": "BuyGoods",
    "merch_code": "000000",
    "merch_order_id": "201907161732001",
    "notify_url": "http://test.payment.com/notify",
    "redirect_url": "http://test.payment.com/redirect",
    "timeout_express": "120m",
    "title": "iphone1",
    "total_amount": "12",
    "trade_type": "Checkout",
    "trans_currency": "ETB",
    "payee_identifier": "200001",
    "payee_identifier_type": "04",
    "payee_type": "5000",
    "callback_info": "From web"
  },
  "method": "payment.preorder",
  "nonce_str": "fcab0d2949e64a69a212aa83eab6ee1d",
  "sign": "JYyVqFAmdgBG4n1eBQYUwNlC...",
  "sign_type": "SHA256WithRSA",
  "timestamp": "1535166225",
  "version": "1.0"
}
```

**Response `biz_content`:**

| Field | Type | Notes |
|---|---|---|
| `merch_order_id` | string(64) | Merchant order ID |
| `prepay_id` | string(128) | Payment process ID — used to build checkout URL |

**Response example:**
```json
{
  "result": "SUCCESS",
  "code": "0",
  "msg": "success",
  "nonce_str": "97fe4ae0c0604854a749fbf2cc1cc712",
  "sign": "Eo4Bvwx9rpaWAO+iYzaaXHoWBWbYcCGnVZMEcG5TPb8w...",
  "sign_type": "SHA256WithRSA",
  "biz_content": {
    "merch_order_id": "1705460512562",
    "prepay_id": "080075a4e3213924de2b3b84ad3cac0a6a6001"
  }
}
```

### 8.4 Generate Checkout URL (backend, no HTTP call)

Build the user-facing redirect URL from `prepay_id`:

```ts
function createRawRequest(prepayId: string): string {
  const map = {
    appid:      TELEBIRR_MERCHANT_APP_ID,
    merch_code: TELEBIRR_MERCHANT_CODE,
    nonce_str:  generateNonceStr(),
    prepay_id:  prepayId,
    timestamp:  Math.floor(Date.now() / 1000).toString(),
  };
  const sign = signTelebirr(map, TELEBIRR_PRIVATE_KEY_PEM); // same algo as main requests
  // IMPORTANT: the docs explicitly require this field order in the URL:
  return [
    "appid="      + map.appid,
    "merch_code=" + map.merch_code,
    "nonce_str="  + map.nonce_str,
    "prepay_id="  + map.prepay_id,
    "timestamp="  + map.timestamp,
    "sign="       + sign,
    "sign_type=SHA256WithRSA",
  ].join("&");
}

function createCheckoutUrl(prepayId: string): string {
  const rawRequest = createRawRequest(prepayId);
  // testbed:  https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?
  // prod:     confirm with ET — likely https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?
  return TELEBIRR_WEB_BASE_URL + rawRequest + "&version=1.0&trade_type=Checkout";
}
```

> Note the trailing `?` on `TELEBIRR_WEB_BASE_URL` and the leading `&` on the `version=1.0&trade_type=Checkout` suffix.

### 8.5 Checkout (front-end, no backend API)

The merchant web page simply redirects the user to the URL from §8.4. Telebirr hosts the payment page; the user inputs their phone number and PIN (or scans a QR). After completion the user is redirected back to `redirect_url` and the result is POSTed to `notify_url`.

> The doc page for "Step 4: Checkout" (`/docs/H5 C2B Web Payment Integration Quick Guide/ CheckOut`) failed to render via the docs site (the trailing-space URL slug appears to break the Docusaurus SPA). The behavior is fully described in Step 3 (Generate Checkout Url) and the H5 Introduction.

### 8.6 Query Order — `POST /payment/v1/merchant/queryOrder`

Identical to [§7.5](#75-query-order--post-paymentv1merchantqueryorder).

### 8.7 Refund Order — `POST /payment/v1/merchant/refund`

> Only documented under H5 integration, but `queryOrder`'s `trade_status` enum reports `ACCEPTED`, `REFUNDING`, `REFUND_SUCCESS`, `REFUND_FAILED` for *both* InApp and H5 — implying refunds are usable for both. InApp merchants should test the same endpoint.

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `timestamp` | string | M | UTC seconds |
| `method` | string | M | Fixed: `"payment.refund"` |
| `nonce_str` | string | M | ≤32 alphanumeric |
| `sign_type` | string | M | `"SHA256WithRSA"` |
| `sign` | string | M | RSA-PSS signature |
| `version` | string | M | `"1.0"` |
| `biz_content` | object | M | See below |

**`biz_content` (RefundRequestInfo):**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `appid` | string(32) | M | Merchant App ID |
| `merch_code` | string(16) | M | Merchant short code |
| `merch_order_id` | string(64) | M | **Original** merchant order ID to refund |
| `refund_request_no` | string(64) | M | Unique refund order number OR the original `trans_id` / Transaction ID of the payment to refund. Sample shows `"CJD7GBPXIP"` (a trans_id shape) |
| `refund_reason` | string(256) | O | Free-form reason |
| `actual_amount` | string | M | Refund amount; must be ≤ original amount (supports partial refunds) |
| `trans_currency` | string(3) | M | Must match original, e.g. `"ETB"` |

**Request example:**
```json
{
  "timestamp": "175938855330",
  "nonce_str": "sdnoe9ufqbe4uuib7subschqg3gjrm8t",
  "method": "payment.refund",
  "sign_type": "SHA256WithRSA",
  "sign": "JKc//uJevJVAelpc9LfQpHm/GoExSkGQ9hNuQwQLnSmRhZSeKPVnMMxh/AuobPuN...",
  "version": "1.0",
  "biz_content": {
    "merch_order_id": "{{merch_order_id}}",
    "appid": "{{MerchantId}}",
    "trans_currency": "ETB",
    "actual_amount": "amount",
    "merch_code": "{{MerchantCode}}",
    "refund_request_no": "{{refund_request_no}}",
    "refund_reason": "refund test"
  }
}
```

**Response `biz_content` (RefundResponseInfo):**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `merch_code` | string(16) | M | Merchant short code |
| `merch_order_id` | string(64) | M | Merchant order ID |
| `trans_order_id` | string | M | Original transaction order ID on Payment side |
| `refund_order_id` | string | M | Refund transaction order ID on Payment side |
| `refund_amount` | string | M | Refund amount |
| `refund_currency` | string | M | Refund currency |
| `refund_status` | string | M | One of: `REFUND_SUCCESS`, `REFUNDING`, `REFUND_FAILED`, `REFUND_DUPLICATED` |
| `refund_time` | string(13) | O | Refund success timestamp (only when successful) |

### 8.8 Notify (webhook) for H5

See [§10](#10-webhook--notify-reference).

---

## 9. Integration C — Subscription (Schedule) Payment

### 9.1 Overview & flow

1. **Prerequisite (offline):** Apply to Ethio telecom for a **mandate template** (`mandateTemplateId`). Templates are frequency-bound: Daily / Weekly / Monthly.
2. **Customer signs mandate** (front-end only — not a backend HTTP API). The merchant's mini-app or H5 page invokes the Telebirr SuperApp SDK to open the mandate-signing page. The customer enters their PIN to authorize PIN-free future deductions. The merchant generates a unique `mctContractNo` (32-digit numeric string) to identify this mandate.
3. **Merchant backend** queries mandate details via `POST /payment/v1/mandates/query` (using `mct_contract_no` or `mandate_contract_id`).
4. **Merchant backend** cancels mandates (if needed) via `POST /payment/v1/mandateContract/cancel`.
5. **Merchant backend** applies a Fabric Token (same `/payment/v1/token` endpoint).
6. **Merchant backend** runs its own scheduler; on each scheduled date it calls `POST /payment/v1/merchant/disburseOrder` (`payment.disbursement`) to pull funds from the customer (PIN-free, authorized by the mandate).
7. **Telebirr** POSTs the disbursement result to `notify_url`.

> **Important:** Telebirr does **not** schedule deductions for you. The merchant implements the scheduling logic; Telebirr only provides (a) the PIN-free mandate capability and (b) the disbursement API.

### 9.2 Sign Mandate Contract (front-end, not an HTTP API)

**H5 application:**
```js
function signContract() {
  const mctShortCode       = "your merchant shortCode";
  const appId              = "your merchant appId";
  const mctContractNo      = generateRandomNumber(); // 32-digit numeric string, unique
  const mandateTemplateId  = "your mandate template id you applied";

  const obj = JSON.stringify({
    functionName: "js_fun_execute",
    params: {
      businessType: "Mandate",
      execute: `merchant://10000000016?mctShortCode=${mctShortCode}&mctContractNo=${mctContractNo}&mandateTemplateId=${mandateTemplateId}&thirdAppId=${appId}`,
      functionCallBackName: "handleinitDataCallback",
    },
  });
  if (typeof rawRequest === "undefined" || rawRequest === null) return;
  if (window.consumerapp === undefined || window.consumerapp === null) {
    console.log("This is not opened in app!");
    return;
  }
  window.consumerapp.evaluate(obj);
}

function generateRandomNumber() {
  let n = "";
  for (let i = 0; i < 32; i++) n += Math.floor(Math.random() * 10);
  return n;
}

// callback
function handleinitDataCallback(mandateResponse) {
  console.log("mandateResponse", mandateResponse);
}
```

**Mini App (AppCube / Macle):**
```js
function signContract() {
  const mctShortCode       = "your merchant shortCode";
  const appId              = "your merchant appId";
  const mctContractNo      = generateRandomNumber();
  const mandateTemplateId  = "your mandate template id you applied";

  window.ma
    .native("gotoFunction", {
      businessType: "Mandate",
      path: `merchant://10000000016?mctShortCode=${mctShortCode}&mctContractNo=${mctContractNo}&mandateTemplateId=${mandateTemplateId}&thirdAppId=${appId}`,
    })
    .then((res) => {
      if (res && res.result === "success") { /* mandate success */ }
    })
    .catch((err) => { /* mandate error */ });
}
```

**URL params:**

| Param | Description |
|---|---|
| `mctShortCode` | Merchant short code |
| `mctContractNo` | Merchant-generated 32-digit numeric contract ID (unique per customer subscription) |
| `mandateTemplateId` | Template ID obtained from Ethio telecom (Daily/Weekly/Monthly) |
| `thirdAppId` | Merchant App ID |

> `mctContractNo` is unique system-wide and cannot be re-subscribed. The same `mandateTemplateId` can only be subscribed **once** by a given telebirr user. The `merchant://10000000016?...` is a deep-link handled by the Telebirr SuperApp.

### 9.3 Apply Fabric Token — `POST /payment/v1/token`

Identical to [§5](#layer-1--fabric-token-short-lived-bearer).

### 9.4 Query Mandate Contract Details — `POST /payment/v1/mandates/query`

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `timestamp` | string | M | UTC seconds |
| `method` | string | M | `"payment.queryMandate"` (sample value; docs table erroneously says `"payment.disbursement"` — copy-paste error) |
| `nonce_str` | string | M | ≤256 chars, `[\w-]+` |
| `sign_type` | string | M | `"SHA256WithRSA"` |
| `sign` | string | M | RSA-PSS signature |
| `version` | string | M | `"1.0"` |
| `biz_content` | object | M | See below |

**`biz_content`:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `appid` | string(32) | M | Merchant App ID |
| `mandate_contract_id` | string | O | Mandate Contract ID (Telebirr-side). Either this or `merch_contract_no` is required. |
| `merch_contract_no` | string | O | Your `mctContractNo` from the sign step. Either this or `mandate_contract_id` is required. |
| `merch_short_code` | string | M | Merchant short code |

> Field-name gotcha: in this endpoint the merchant contract number is called `merch_contract_no`. In `disburseOrder` (§9.6) the same concept is called `mct_contract_no`. Be careful.

**Request example:**
```json
{
  "method": "payment.queryMandate",
  "nonce_str": "mjszBCV17eGtdFhPfyPDelZWCY52ASGd",
  "sign": "m0PhK8y=GdpTQFFwhj9Od4JnawW9MrB0IfZ=R3VUcQrI9m/pl7yuZs/1Dl+IczQvIx84bF=+kAe3xCYogiJoStCMQ",
  "sign_type": "SHA256WithRSA",
  "timestamp": "456976396",
  "version": "1.0",
  "biz_content": {
    "appid": "string",
    "mandate_contract_id": "string",
    "merch_contract_no": "string",
    "merch_short_code": "string"
  }
}
```

**Response `biz_content`:**

| Field | Type | Notes |
|---|---|---|
| `appid` | string | APP ID of the Mandate order |
| `create_time` | string (date-time) | Mandate contract create time |
| `total_amount` | string | Total deduction amount cap |
| `currency` | string(3) | e.g. `"ETB"` |
| `execute_time` | string (date) | Execute Time |
| `expiry_date` | string (date) | Expiry date |
| `mandate_contract_id` | string | Telebirr-side Mandate Contract ID |
| `mandate_description` | string | Description |
| `mandate_name` | string | Name |
| `mandate_prod` | string | `CYCLE_PAY` or `DIRECT_DEBIT` |
| `mandate_template_id` | string | Template ID |
| `merch_contract_no` | string | Your mctContractNo |
| `payer_id` | string | Identity ID of the authorized payer |
| `payer_type` | string | payer_type |
| `payment_order_id` | string | payment_order_id |
| `period_count` | int64 | Number of cycles (with `period_type`) |
| `period_type` | string | `DAY`, `TIMES`, or `Month` |
| `single_amount` | string | Max amount per withholding |
| `status` | string | `active` = success; other = failed |

**Response example:**
```json
{
  "biz_content": {
    "appid": "string",
    "create_time": "2023-07-28T17:40:18.964Z",
    "currency": "ETB",
    "execute_time": "2023-07-28",
    "expiry_date": "2023-07-28",
    "mandate_contract_id": "string",
    "mandate_description": "string",
    "mandate_name": "string",
    "mandate_prod": "CYCLE_PAY",
    "mandate_template_id": "string",
    "merch_contract_no": "string",
    "payer_id": "string",
    "payer_type": "string",
    "payment_order_id": "string",
    "period_count": 0,
    "period_type": "Month",
    "single_amount": "string",
    "status": "active",
    "total_amount": "string"
  },
  "code": "0",
  "msg": "string",
  "nonce_str": "string",
  "result": "SUCCESS",
  "sign": "string",
  "sign_type": "SHA256WithRSA"
}
```

**Error (HTTP 405):** `{ "errorCode": "string", "errorMsg": "string" }`

### 9.5 Cancel Mandate Contract — `POST /payment/v1/mandateContract/cancel`

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `timestamp` | string | M | UTC seconds |
| `method` | string | M | `"payment.cancelMandate"` (sample value; docs table erroneously says `"payment.disbursement"` — copy-paste error) |
| `nonce_str` | string | M | ≤256 chars |
| `sign_type` | string | M | `"SHA256WithRSA"` |
| `sign` | string | M | RSA-PSS signature |
| `version` | string | M | `"1.0"` |
| `biz_content` | object | M | See below |

**`biz_content`:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `merch_code` | string | M | Merchant short code |
| `mandate_contract_id` | string | M | Mandate Contract ID |
| `reason` | string | M | Cancel reason |
| `initiator` | string | M | Customer phone number (MSISDN) |
| `description` | string | O | Description |
| `initiator_type` | string | M | Fixed: `"10"` |

> The sample request body also includes a top-level `"lang": ""` field (presumably for locale). Not documented as required.

**Request example:**
```json
{
  "lang": "",
  "method": "payment.cancelMandate",
  "nonce_str": "mjszBCV17eGtdFhPfyPDelZWCY52ASGd",
  "sign": "m0PhK8y=GdpTQFFwhj9Od4JnawW9MrB0IfZ=R3VUcQrI9m/pl7yuZs/1Dl+IczQvIx84bF=+kAe3xCYogiJoStCMQ...",
  "sign_type": "SHA256WithRSA",
  "timestamp": "456976396",
  "version": "1.0",
  "biz_content": {
    "merch_code": "string",
    "reason": "string",
    "initiator": "string",
    "description": "string",
    "mandate_contract_id": "string",
    "initiator_type": "10"
  }
}
```

**Response body schema:** only the standard envelope, no `biz_content`:
```json
{
  "code": "0",
  "msg": "string",
  "nonce_str": "string",
  "result": "SUCCESS",
  "sign": "...",
  "sign_type": "SHA256WithRSA"
}
```

### 9.6 Create Disburse Order (PIN-free deduction) — `POST /payment/v1/merchant/disburseOrder`

This is the actual subscription charge — server-to-server, no user interaction.

**Headers:** `X-APP-Key`, `Authorization: Bearer {token}`, `Content-Type: application/json`

**Request body schema:**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `timestamp` | string | M | UTC seconds |
| `method` | string | M | Fixed: `"payment.disbursement"` |
| `nonce_str` | string | M | ≤256 chars |
| `sign_type` | string | M | `"SHA256WithRSA"` |
| `sign` | string | M | RSA-PSS signature |
| `version` | string | M | `"1.0"` |
| `biz_content` | object | M | See below |

**`biz_content` (CreateDisburseOrderBizContent):**

| Field | Type | M/O | Notes |
|---|---|---|---|
| `appid` | string(32) | M | Merchant App ID |
| `merch_code` | string(16) | M | Merchant short code |
| `merch_order_id` | string(64) | M | Unique merchant order ID |
| `trade_type` | string | M | `"Disbursement"` (docs also mention `"Mandate"` in sample — confirm with ET) |
| `title` | string(512) | M | Offering name |
| `payee_msisdn` | string(32) | M | MSISDN of payee (the merchant's phone number) |
| `total_amount` | string(20) | M | Deduction amount |
| `trans_currency` | string(3) | M | e.g. `"ETB"` |
| `operator_id` | string(32) | M | Operator ID |
| `timeout_express` | string(10) | M | e.g. `"120m"` |
| `business_type` | string(32) | M | e.g. `"BuyGoods"` (sample uses `"Buy goods"`) |
| `note_payer` | string(1024) | M | Note for payer |
| `mandate_contract_id` | string | M | Telebirr-side mandate ID |
| `mct_contract_no` | string(32) | M | Your original `mctContractNo` from the sign step |

> The docs say "Either the `mandate_contract_id` or `mct_contract_no` must be provided" but the schema marks both as M. Pass both if you have them.

**Request example:**
```json
{
  "timestamp": "1563161657",
  "method": "payment.disbursement",
  "nonce_str": "5K8264ILTKCH16CQ2502SI8ZNMTM67VS",
  "sign_type": "SHA256WithRSA",
  "sign": "BC4EE8D710BAC6A7E33DE4511A1CE7723024615EEF491B80DEF7DC743D4DADBE",
  "version": "1.0",
  "biz_content": {
    "appid": "914633313806501",
    "merch_code": "200001",
    "merch_order_id": "201907161732001",
    "trade_type": "Mandate",
    "title": "GameRecharge",
    "payee_msisdn": "900000000",
    "total_amount": "2000",
    "trans_currency": "ETB",
    "operator_id": "0000",
    "timeout_express": "120m",
    "business_type": "BuyGoods",
    "note_payer": "XXXX",
    "mandate_contract_id": "string",
    "mct_contract_no": "XXXX"
  }
}
```

**Response `biz_content`:**

| Field | Type | Notes |
|---|---|---|
| `merch_order_id` | string(64) | Merchant order ID |
| `payment_order_id` | string(64) | Telebirr-side order ID |
| `total_amount` | string(20) | Deduction amount |
| `trans_currency` | string(3) | Currency |
| `pay_success_time` | string | Time of successful payment |
| `payer_fee` | string | Payer fee amount |
| `payee_fee` | string | Payee fee amount |

**Response example:**
```json
{
  "result": "SUCCESS",
  "code": "0",
  "msg": "Success",
  "nonce_str": "274E40E9388047778768B67068B9C8AF",
  "sign": "BC4EE8D710BAC6A7E33DE4511A1CE7723024615EEF491B80DEF7DC743D4DADBE",
  "sign_type": "SHA256WithRSA",
  "biz_content": {
    "merch_order_id": "201907151435001",
    "payment_order_id": "007a6bd3175cdb3c658545a4f3f85fac23143239021",
    "total_amount": "2000",
    "trans_currency": "ETB",
    "pay_success_time": "string",
    "payer_fee": "string",
    "payee_fee": "string"
  }
}
```

### 9.7 Notify (webhook) for Subscription

See [§10](#10-webhook--notify-reference). Same payload schema as InApp/H5.

---

## 10. Webhook / Notify Reference

Telebirr POSTs the payment result to the `notify_url` you supplied when creating the order/disbursement. **The endpoint must be whitelisted on the SuperApp server** — contact ET to register it. Respond with HTTP 200 to acknowledge.

### Request

- **Method:** `POST`
- **Content-Type:** `application/json`
- **Body schema** (identical for InApp, H5, and Subscription):

| Field | Type | M/O | Notes |
|---|---|---|---|
| `notify_url` | string(512) | O | Echo of the callback URL |
| `appid` | string(32) | O | Merchant App ID |
| `notify_time` | string | O | Notification send time (UTC seconds, long) |
| `merch_code` | string(16) | O | Merchant short code |
| `merch_order_id` | string(64) | M | Your order ID |
| `payment_order_id` | string(64) | M | Telebirr-side order ID |
| `total_amount` | string(20) | O | Amount (e.g. `"10.00"`) |
| `trans_id` | string | (in samples) | Transaction ID — present in samples but not in the schema table |
| `trans_currency` | string(3) | O | e.g. `"ETB"` |
| `trade_status` | string(4) | M | See values below |
| `trans_end_time` | string | M | Transaction end time (UTC seconds) |
| `callback_info` | string | O | Echo of `callback_info` you sent at createOrder |
| `sign` | string(512) | M | Response signature (signed by SP's private key) |
| `sign_type` | string | M | `"SHA256WithRSA"` |

**`trade_status` values (in notify):**

| Value | Meaning |
|---|---|
| `Paying` | User has paid, but cards/coupons/other transactions still being agreed |
| `Expired` | Status after reconciliation is unclear |
| `Pending` | Payment completed, awaiting order synchronization |
| `Completed` | Payment completed |
| `Failure` | Payment failed |

> Note: the notify's `trade_status` uses different value names (`Completed`, `Failure`) than the queryOrder response (`PAY_SUCCESS`, `PAY_FAILED`). This is a real inconsistency in the Telebirr API — handle both sets.

### Notify payload example
```json
{
  "notify_url":        "http://197.156.68.29:5050/v2/api/order-v2/mini/payment",
  "appid":             "853694808089634",
  "notify_time":       "1670575472482",
  "merch_code":        "245445",
  "merch_order_id":    "1670575560882",
  "payment_order_id":  "00801104C911443200001002",
  "total_amount":      "10.00",
  "trans_id":          "49485948475845",
  "trans_currency":    "ETB",
  "trade_status":      "Completed",
  "trans_end_time":    "1670575472000",
  "sign":              "AOwWQF0QDg0jzzs5otLYOunoR65GGgC3hyr+oYn8mm1Qph6Een7C...",
  "sign_type":         "SHA256WithRSA"
}
```

### Verifying the notify signature

The notify payload is signed by Ethio telecom with their private key. You must verify `sign` using the **SP's public key** (which you obtain from ET — separate from your own key pair) before trusting the payload. Use the same canonicalization as [§6](#6-signature-algorithm-sha256withrsa--pss):

1. Drop `sign` and `sign_type` from the payload.
2. Drop any empty/null fields.
3. Sort remaining keys lexicographically.
4. Join as `key=value&key=value...`.
5. Verify with `RSA-PSS-SHA256` using ET's public key.

If verification fails, **reject the notification** (return non-200 and log).

### Notify response

- **HTTP 200** = processed successful.
- Returning non-200 causes Telebirr to retry (per the docs — retry policy not specified; assume exponential backoff).

> **Idempotency:** Telebirr may send the same notify more than once. Make your handler idempotent (key on `merch_order_id` + `payment_order_id` + `trans_id`).

---

## 11. Refunds

### Endpoint
`POST /payment/v1/merchant/refund` (documented under H5 integration; see [§8.7](#87-refund-order--post-paymentv1merchantrefund) for full schema).

### Behavior
- `actual_amount` may be ≤ original amount → **partial refunds supported**.
- `refund_request_no` is a unique refund ID you generate (or you can pass the original `trans_id` — docs are ambiguous; pass a unique ID per refund attempt to avoid `REFUND_DUPLICATED`).
- Refund status query is via the `queryOrder` endpoint — its response `trade_status` returns `ACCEPTED`, `REFUNDING`, `REFUND_SUCCESS`, or `REFUND_FAILED`.
- InApp and Subscription docs do not document refund explicitly, but since queryOrder reports refund status for all integrations, the same `/payment/v1/merchant/refund` endpoint is likely usable. **Test in sandbox first.**

### Refund response statuses
| `refund_status` | Meaning |
|---|---|
| `REFUND_SUCCESS` | Refund successful |
| `REFUNDING` | Refund in progress |
| `REFUND_FAILED` | Refund failed |
| `REFUND_DUPLICATED` | Duplicate refund request (same `refund_request_no` already used) |

---

## 12. Gotchas, Quirks & Doc Inconsistencies

A consolidated checklist of things that will bite you:

1. **InApp Create Order endpoint inconsistency.** The spec table says `/payment/v1/inapp/createOrder`; the sample code uses `/payment/v1/merchant/inapp/createOrder`. Try the spec path first, fall back to the sample path on 404. Confirm with ET.

2. **H5 production `webBaseUrl` likely wrong in docs.** Sample config sets it to the *API* base URL (`https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway`) instead of the web paygate URL. Testbed uses `https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?` (different path). Verify production URL with ET.

3. **Signature padding is PSS, not PKCS#1 v1.5.** The Python sample uses `PKCS1_v1_5` — wrong. JS, Java, C#, and PHP samples all use PSS / MGF1-SHA256. Use `RSA_PKCS1_PSS_PADDING` in Node's `crypto`.

4. **`biz_content` is excluded as a key but its children are signed.** Easy to get wrong. The exclude list applies to both top-level keys and nested keys.

5. **`trade_status` value names differ between notify and queryOrder.**
   - Notify: `Completed`, `Failure`, `Pending`, `Paying`, `Expired`
   - queryOrder: `PAY_SUCCESS`, `PAY_FAILED`, `WAIT_PAY`, `ORDER_CLOSED`, `PAYING`, `ACCEPTED`, `REFUNDING`, `REFUND_SUCCESS`, `REFUND_FAILED`
   Map both ways in your state machine.

6. **Field name inconsistencies in Subscription:**
   - `merch_contract_no` (Query Mandate) vs `mct_contract_no` (Disburse Order) vs `mandate_contract_id` (Telebirr-side ID, used in Query/Cancel/Disburse). All three refer to overlapping concepts — be precise.
   - `merch_code` (most endpoints) vs `merch_short_code` (Query Mandate) vs `mctShortCode` (Sign Contract URL param, camelCase).
   - `mctContractNo` (Sign Contract URL param, camelCase) is the *same value* as `merch_contract_no` / `mct_contract_no` (snake_case) elsewhere.

7. **`method` field in Subscription Query/Cancel has doc copy-paste errors.** Schema table says `"payment.disbursement"` for both Query Mandate and Cancel Mandate, but the JSON samples say `"payment.queryMandate"` and `"payment.cancelMandate"`. Use the sample values.

8. **`version` field typo in Subscription Query sample:** `"1(0"` instead of `"1.0"`. Use `"1.0"`.

9. **`payee_type` differs between InApp (`"3000"`) and H5 sample (`"5000"`).** Confirm with ET which value applies to your merchant registration.

10. **`notify_url` must be whitelisted on the SuperApp server.** Even if you set it in the request, callbacks won't fire until ET registers it. Plan this in advance.

11. **`merch_order_id` must be alphanumeric + underscores only.** No hyphens, no dots, no other special chars. Pattern: `^[A-Za-z0-9_]+$`. Using `Date.now()` as a string works.

12. **`timeout_express` cannot contain dots.** `"1.5h"` is invalid; convert to `"90m"`. Range 1–120 minutes.

13. **Fabric token includes the `Bearer ` prefix.** Don't add another `"Bearer "`. Pass the returned `token` value verbatim as the `Authorization` header.

14. **Testbed HTTPS may use a self-signed cert.** Sample code disables verification (`rejectUnauthorized: false`). **Do not ship this in production.** Either get the proper CA from ET or pin a known fingerprint.

15. **`timestamp` is UTC seconds (despite docs saying "13 characters").** 13 chars would be milliseconds, but the sample values are 10-digit Unix seconds. Use `Math.floor(Date.now() / 1000).toString()` to be safe (fits in 13 chars). Pattern allows up to 13 digits.

16. **Step numbering skips in H5 docs:** goes Step 5 → Step 7 → Step 8 (no Step 6). Just a doc error.

17. **iOS SDK file extension is `.aar` (Android Archive) in the docs.** This is wrong — iOS uses `.framework` or `.xcframework`. Get the correct artifact from ET.

18. **`nonce_str` regex `\S+` (no whitespace) but also "no special characters"** in description. Stick to alphanumeric + maybe `_`/`-`. Use `crypto.randomUUID().replace(/-/g, "")` for 32-char hex.

19. **Subscription Sign Contract is not a backend API** — it's a front-end SDK call (`window.consumerapp.evaluate(...)` for H5, `window.ma.native(...)` for Mini App). Your backend can't sign contracts on behalf of users.

20. **Telebirr does not schedule subscription deductions for you.** You must implement the scheduler (cron, BullMQ, etc.) and call `disburseOrder` yourself on each billing date.

21. **Same `mandateTemplateId` can only be subscribed once per telebirr user.** If a user cancels and re-subscribes, you may need a fresh `mandateTemplateId` or a fresh `mctContractNo` — confirm with ET.

22. **`mctContractNo` is system-unique.** Generate as a 32-digit random numeric string; never reuse.

23. **Refund `refund_request_no` ambiguity.** Docs say "unique refund order number request or Transaction Id of the payment going to be refunded." If you pass the original `trans_id`, you may hit `REFUND_DUPLICATED` on retries. Generate a unique ID per refund attempt for safety, but be prepared for ET to expect `trans_id` — test in sandbox.

24. **`sign_type` value is `"SHA256WithRSA"` (mixed case)** in request bodies. The algorithm name in code is `"SHA256withRSAandMGF1"` (jsrsasign) or `"SHA256withRSA/PSS"` (Java). Don't conflate the `sign_type` *string value* with the *algorithm constant*.

25. **No documented HMAC support despite mention.** Refund response schema says `sign_type` "supports HmacSHA256 and SHA256WithRSA" but no HMAC flow is documented anywhere. Ignore; use SHA256WithRSA everywhere.

---

## 13. Reference Node.js/TypeScript Implementation

A minimal, production-shaped scaffold. Drop into `src/telebirr/`.

### `src/telebirr/config.ts`
```ts
export interface TelebirrConfig {
  baseUrl: string;            // https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway
  webBaseUrl: string;         // https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?
  fabricAppId: string;        // X-APP-Key
  appSecret: string;
  merchantAppId: string;      // appid
  merchantCode: string;       // merch_code / shortCode
  privateKeyPem: string;      // your RSA private key (PEM)
  spPublicKeyPem: string;     // Ethio telecom's RSA public key (PEM)
  notifyBaseUrl: string;      // e.g. https://yourbackend.com/webhooks/telebirr
}

export const telebirrConfig: TelebirrConfig = {
  baseUrl:          process.env.TELEBIRR_BASE_URL!,
  webBaseUrl:       process.env.TELEBIRR_WEB_BASE_URL!,
  fabricAppId:      process.env.TELEBIRR_X_APP_KEY!,
  appSecret:        process.env.TELEBIRR_APP_SECRET!,
  merchantAppId:    process.env.TELEBIRR_MERCHANT_APP_ID!,
  merchantCode:     process.env.TELEBIRR_MERCHANT_CODE!,
  privateKeyPem:    process.env.TELEBIRR_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
  spPublicKeyPem:   process.env.TELEBIRR_SP_PUBLIC_KEY_PEM!.replace(/\\n/g, "\n"),
  notifyBaseUrl:    process.env.TELEBIRR_NOTIFY_BASE_URL!,
};
```

### `src/telebirr/sign.ts`
```ts
import crypto from "crypto";

const EXCLUDE_FIELDS = new Set([
  "sign", "sign_type", "header", "refund_info",
  "openType", "raw_request", "biz_content", "wallet_reference_data",
]);

export function buildStringToSign(req: Record<string, any>): string {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(req)) {
    if (EXCLUDE_FIELDS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    flat[k] = String(v);
  }
  const biz = req.biz_content;
  if (biz && typeof biz === "object") {
    for (const [k, v] of Object.entries(biz)) {
      if (EXCLUDE_FIELDS.has(k)) continue;
      if (v === undefined || v === null || v === "") continue;
      flat[k] = String(v);
    }
  }
  return Object.keys(flat)
    .sort()
    .map((k) => `${k}=${flat[k]}`)
    .join("&");
}

export function signTelebirr(req: Record<string, any>, privateKeyPem: string): string {
  const data = buildStringToSign(req);
  return crypto
    .sign("sha256", Buffer.from(data, "utf8"), {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
}

export function verifyTelebirr(
  payload: Record<string, any>,
  signatureBase64: string,
  spPublicKeyPem: string,
): boolean {
  const data = buildStringToSign(payload);
  return crypto.verify(
    "sha256",
    Buffer.from(data, "utf8"),
    {
      key: spPublicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    Buffer.from(signatureBase64, "base64"),
  );
}

export function createNonceStr(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function createTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

export function createMerchantOrderId(): string {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}
```

### `src/telebirr/client.ts`
```ts
import { telebirrConfig } from "./config";
import { signTelebirr, createNonceStr, createTimestamp } from "./sign";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function applyFabricToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${telebirrConfig.baseUrl}/payment/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-APP-Key": telebirrConfig.fabricAppId,
    },
    body: JSON.stringify({ appSecret: telebirrConfig.appSecret }),
  });
  if (!res.ok) throw new Error(`applyFabricToken HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as { token: string; expirationDate: string };
  // expirationDate is yyyyMMddHHmmss
  const expiresAt = parseTelebirrDate(data.expirationDate);
  cachedToken = { token: data.token, expiresAt };
  return data.token;
}

function parseTelebirrDate(s: string): number {
  // yyyyMMddHHmmss -> epoch ms
  const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8),
    h = +s.slice(8, 10), mi = +s.slice(10, 12), se = +s.slice(12, 14);
  return Date.UTC(y, mo, d, h, mi, se);
}

async function callBusinessApi<T = any>(
  endpoint: string,
  bizContent: Record<string, any>,
  method: string,
): Promise<T> {
  const token = await applyFabricToken();
  const req: Record<string, any> = {
    timestamp: createTimestamp(),
    nonce_str: createNonceStr(),
    method,
    version: "1.0",
    biz_content: bizContent,
  };
  req.sign = signTelebirr(req, telebirrConfig.privateKeyPem);
  req.sign_type = "SHA256WithRSA";

  const res = await fetch(`${telebirrConfig.baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-APP-Key": telebirrConfig.fabricAppId,
      "Authorization": token, // already includes "Bearer "
    },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Telebirr ${endpoint} HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------- InApp ----------
export interface CreateOrderResponse {
  result: string; code: string; msg: string;
  nonce_str: string; sign: string; sign_type: string;
  biz_content: {
    merch_order_id: string;
    prepay_id: string;
    receiveCode?: string; // InApp only
  };
}

export async function createInAppOrder(params: {
  merchOrderId: string; title: string; amount: string;
  notifyUrl: string; redirectUrl?: string;
  timeoutExpress?: string;
}): Promise<CreateOrderResponse> {
  return callBusinessApi<CreateOrderResponse>(
    "/payment/v1/inapp/createOrder",
    {
      appid: telebirrConfig.merchantAppId,
      merch_code: telebirrConfig.merchantCode,
      merch_order_id: params.merchOrderId,
      notify_url: params.notifyUrl,
      redirect_url: params.redirectUrl ?? "",
      trade_type: "InApp",
      title: params.title,
      total_amount: params.amount,
      trans_currency: "ETB",
      timeout_express: params.timeoutExpress ?? "120m",
      business_type: "BuyGoods",
      payee_identifier: telebirrConfig.merchantCode,
      payee_identifier_type: "04",
      payee_type: "3000",
    },
    "payment.preorder",
  );
}

// ---------- H5 ----------
export async function createH5PreOrder(params: {
  merchOrderId: string; title: string; amount: string;
  notifyUrl: string; redirectUrl?: string;
  timeoutExpress?: string; callbackInfo?: string;
}): Promise<CreateOrderResponse> {
  return callBusinessApi<CreateOrderResponse>(
    "/payment/v1/merchant/preOrder",
    {
      appid: telebirrConfig.merchantAppId,
      merch_code: telebirrConfig.merchantCode,
      merch_order_id: params.merchOrderId,
      notify_url: params.notifyUrl,
      redirect_url: params.redirectUrl ?? "",
      trade_type: "Checkout",
      title: params.title,
      total_amount: params.amount,
      trans_currency: "ETB",
      timeout_express: params.timeoutExpress ?? "120m",
      business_type: "BuyGoods",
      payee_identifier: telebirrConfig.merchantCode,
      payee_identifier_type: "04",
      payee_type: "5000",
      callback_info: params.callbackInfo ?? "",
    },
    "payment.preorder",
  );
}

export function buildH5CheckoutUrl(prepayId: string): string {
  const map = {
    appid: telebirrConfig.merchantAppId,
    merch_code: telebirrConfig.merchantCode,
    nonce_str: createNonceStr(),
    prepay_id: prepayId,
    timestamp: createTimestamp(),
  };
  const sign = signTelebirr(map, telebirrConfig.privateKeyPem);
  // NOTE: docs require this exact field order in the URL string:
  const rawRequest = [
    `appid=${map.appid}`,
    `merch_code=${map.merch_code}`,
    `nonce_str=${map.nonce_str}`,
    `prepay_id=${map.prepay_id}`,
    `timestamp=${map.timestamp}`,
    `sign=${sign}`,
    `sign_type=SHA256WithRSA`,
  ].join("&");
  return `${telebirrConfig.webBaseUrl}${rawRequest}&version=1.0&trade_type=Checkout`;
}

// ---------- Query Order (InApp + H5) ----------
export async function queryOrder(merchOrderId: string) {
  return callBusinessApi(
    "/payment/v1/merchant/queryOrder",
    {
      appid: telebirrConfig.merchantAppId,
      merch_code: telebirrConfig.merchantCode,
      merch_order_id: merchOrderId,
    },
    "payment.queryorder",
  );
}

// ---------- Refund (H5; likely works for InApp too) ----------
export async function refundOrder(params: {
  merchOrderId: string;       // original order ID
  refundRequestNo: string;    // unique refund ID you generate
  amount: string;
  reason?: string;
}) {
  return callBusinessApi(
    "/payment/v1/merchant/refund",
    {
      appid: telebirrConfig.merchantAppId,
      merch_code: telebirrConfig.merchantCode,
      merch_order_id: params.merchOrderId,
      refund_request_no: params.refundRequestNo,
      refund_reason: params.reason ?? "customer request",
      actual_amount: params.amount,
      trans_currency: "ETB",
    },
    "payment.refund",
  );
}

// ---------- Subscription / Mandate ----------
export async function queryMandate(params: {
  mandateContractId?: string;
  merchContractNo?: string;
}) {
  return callBusinessApi(
    "/payment/v1/mandates/query",
    {
      appid: telebirrConfig.merchantAppId,
      mandate_contract_id: params.mandateContractId ?? "",
      merch_contract_no: params.merchContractNo ?? "",
      merch_short_code: telebirrConfig.merchantCode,
    },
    "payment.queryMandate",
  );
}

export async function cancelMandate(params: {
  mandateContractId: string;
  reason: string;
  initiatorMsisdn: string;
  description?: string;
}) {
  return callBusinessApi(
    "/payment/v1/mandateContract/cancel",
    {
      merch_code: telebirrConfig.merchantCode,
      mandate_contract_id: params.mandateContractId,
      reason: params.reason,
      initiator: params.initiatorMsisdn,
      description: params.description ?? "",
      initiator_type: "10",
    },
    "payment.cancelMandate",
  );
}

export async function createDisburseOrder(params: {
  merchOrderId: string;
  title: string;
  payeeMsisdn: string;
  amount: string;
  mandateContractId: string;
  mctContractNo: string;
  operatorId: string;
  notifyUrl: string;
  notePayer?: string;
  timeoutExpress?: string;
}) {
  return callBusinessApi(
    "/payment/v1/merchant/disburseOrder",
    {
      appid: telebirrConfig.merchantAppId,
      merch_code: telebirrConfig.merchantCode,
      merch_order_id: params.merchOrderId,
      trade_type: "Disbursement",
      title: params.title,
      payee_msisdn: params.payeeMsisdn,
      total_amount: params.amount,
      trans_currency: "ETB",
      operator_id: params.operatorId,
      timeout_express: params.timeoutExpress ?? "120m",
      business_type: "BuyGoods",
      note_payer: params.notePayer ?? "",
      mandate_contract_id: params.mandateContractId,
      mct_contract_no: params.mctContractNo,
    },
    "payment.disbursement",
  );
}
```

### `src/telebirr/webhook.ts`
```ts
import { telebirrConfig } from "./config";
import { verifyTelebirr } from "./sign";

export interface TelebirrNotifyPayload {
  notify_url?: string;
  appid?: string;
  notify_time?: string;
  merch_code?: string;
  merch_order_id: string;
  payment_order_id: string;
  total_amount?: string;
  trans_id?: string;
  trans_currency?: string;
  trade_status: "Paying" | "Expired" | "Pending" | "Completed" | "Failure";
  trans_end_time: string;
  callback_info?: string;
  sign: string;
  sign_type: string;
}

export function verifyTelebirrNotify(payload: TelebirrNotifyPayload): boolean {
  const { sign, sign_type, ...rest } = payload;
  return verifyTelebirr(rest as any, sign, telebirrConfig.spPublicKeyPem);
}

// Express handler example
import express from "express";
const router = express.Router();

router.post("/webhooks/telebirr", express.json(), async (req, res) => {
  const payload = req.body as TelebirrNotifyPayload;
  if (!verifyTelebirrNotify(payload)) {
    console.error("Telebirr notify signature verification failed", payload);
    return res.status(400).send("invalid signature");
  }
  try {
    // TODO: idempotent insert into your DB keyed on merch_order_id + payment_order_id + trans_id
    switch (payload.trade_status) {
      case "Completed":
        await markOrderPaid(payload.merch_order_id, payload.total_amount, payload.payment_order_id);
        break;
      case "Failure":
        await markOrderFailed(payload.merch_order_id);
        break;
      default:
        // Paying / Pending / Expired — log and wait for next notify or queryOrder
        console.log("Telebirr intermediate status", payload.trade_status, payload.merch_order_id);
    }
    res.status(200).send("OK"); // must be 200 to ack
  } catch (err) {
    console.error("Telebirr notify handling failed", err);
    res.status(500).send("internal error"); // non-200 triggers retry
  }
});

async function markOrderPaid(_id: string, _amt: string, _payId: string) { /* TODO */ }
async function markOrderFailed(_id: string) { /* TODO */ }
```

---

## Appendix — Endpoint Quick Reference

| Integration | Step | Method | Endpoint | `method` field |
|---|---|---|---|---|
| All | Apply Fabric Token | POST | `/payment/v1/token` | n/a (body is `{appSecret}`) |
| InApp | Create Order | POST | `/payment/v1/inapp/createOrder` *(or `/payment/v1/merchant/inapp/createOrder`)* | `payment.preorder` |
| InApp | Start Pay | (SDK) | n/a — front-end SDK call | n/a |
| InApp | Query Order | POST | `/payment/v1/merchant/queryOrder` | `payment.queryorder` |
| InApp | Notify | POST | `{notify_url}` (your webhook) | n/a |
| H5 | Create Order | POST | `/payment/v1/merchant/preOrder` | `payment.preorder` |
| H5 | Generate Checkout URL | (local) | Build URL: `{webBaseUrl}{rawRequest}&version=1.0&trade_type=Checkout` | n/a |
| H5 | Checkout | (browser) | Redirect user to generated URL | n/a |
| H5 | Query Order | POST | `/payment/v1/merchant/queryOrder` | `payment.queryorder` |
| H5 | Refund | POST | `/payment/v1/merchant/refund` | `payment.refund` |
| H5 | Notify | POST | `{notify_url}` (your webhook) | n/a |
| Subscription | Sign Mandate | (SDK) | n/a — front-end SDK deep-link to `merchant://10000000016?...` | n/a |
| Subscription | Query Mandate | POST | `/payment/v1/mandates/query` | `payment.queryMandate` |
| Subscription | Cancel Mandate | POST | `/payment/v1/mandateContract/cancel` | `payment.cancelMandate` |
| Subscription | Disburse (charge) | POST | `/payment/v1/merchant/disburseOrder` | `payment.disbursement` |
| Subscription | Notify | POST | `{notify_url}` (your webhook) | n/a |

### Base URLs (recap)
- API base (testbed): `https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway`
- API base (production): `https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway`
- Web paygate base (testbed): `https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?`
- Web paygate base (production): **confirm with ET** — likely `https://superapp.ethiomobilemoney.et:38443/payment/web/paygate?`

---

*Document compiled from the official Telebirr developer portal (developer.ethiotelecom.et). All field names, endpoint paths, and sample values are reproduced as documented. Where the docs contain internal inconsistencies, they are flagged in [§12](#12-gotchas-quirks--doc-inconsistencies). Confirm production values and ambiguous fields with Ethio telecom before going live.*
