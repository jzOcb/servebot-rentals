# ServeBot Rentals — Code Review Report

**Date:** 2026-03-01  
**Reviewer:** Business Agent (automated)  
**Scope:** Full codebase — API endpoints, frontend booking flow, database schema, edge cases

---

## Summary

The project is a well-structured static HTML + Vercel serverless functions booking system. The core flow works: select rental type → pick date → fill form → pay via Stripe → webhook confirms booking. However, there are several **critical security gaps**, **race conditions**, and **missing features** that should be addressed before scaling.

**Issue Count:** 6 Critical, 5 High, 8 Medium, 6 Low

---

## 🔴 Critical Issues

### C1. CORS Allow-Origin Wildcard on API Endpoints
**File:** `api/bookings.js`, `api/availability.js`, `vercel.json`  
**Severity:** Critical  

Both API handlers and `vercel.json` set `Access-Control-Allow-Origin: *`. This allows any website to submit booking requests and probe availability on behalf of users.

**Risk:** CSRF-like attacks — a malicious site could auto-submit bookings using a victim's form data.  
**Fix:** Restrict to `https://servebot-rentals.vercel.app` and any custom domain.

---

### C2. Race Condition — Double Bookings
**File:** `api/bookings.js` (lines ~70-85)  
**Severity:** Critical  

The availability check and booking insert are **not atomic**. Two concurrent requests for the last available machine on the same date can both pass the `existingBookings.length >= 3` check, then both insert, resulting in 4 bookings for 3 machines.

```
Request A: check → 2 bookings found → OK
Request B: check → 2 bookings found → OK
Request A: insert → 3 bookings
Request B: insert → 4 bookings ← DOUBLE BOOKED
```

**Fix:** Use a Supabase database function with `SELECT ... FOR UPDATE` or a unique constraint + advisory lock. Alternatively, add a Postgres function that does the check-and-insert atomically.

---

### C3. No Rate Limiting on Booking Endpoint
**File:** `api/bookings.js`  
**Severity:** Critical  

No rate limiting exists. An attacker can:
1. Spam POST /api/bookings to create thousands of `pending` bookings, exhausting all availability
2. Each creates a Stripe Checkout session (Stripe API calls have costs at scale)
3. Never pay — bookings stay `pending` and block real customers

**Fix:** Add rate limiting via Vercel Edge Middleware or Upstash Redis. Limit to ~5 bookings per IP per hour.

---

### C4. Pending Bookings Block Availability Indefinitely
**File:** `api/bookings.js`, `api/availability.js`  
**Severity:** Critical  

`pending` bookings count toward availability (`status IN ('pending', 'confirmed', 'in_progress')`). If a user creates a booking but abandons Stripe Checkout, the booking stays `pending` forever — blocking that date for all future customers.

The webhook handles `checkout.session.expired` to cancel, but **Stripe Checkout sessions expire after 24 hours by default**. During those 24 hours, the slot is blocked.

**Fix:**
1. Set `expires_at` on Stripe Checkout sessions to 30 minutes: `stripe.checkout.sessions.create({ expires_at: Math.floor(Date.now()/1000) + 1800, ... })`
2. Add a cron job or Supabase scheduled function to cancel stale `pending` bookings older than 30 min
3. Consider NOT inserting the booking until payment succeeds (create booking in webhook instead)

---

### C5. No Input Sanitization on User-Supplied Data
**File:** `api/bookings.js`  
**Severity:** Critical  

`customer_name`, `customer_email`, `customer_phone`, `delivery_address`, and `notes` are stored directly without sanitization. While Supabase parameterized queries prevent SQL injection, there's:
- **No email format validation** (just checks for existence)
- **No phone format validation**
- **No length limits** — user can submit megabytes of text in `notes`
- **XSS risk** if any admin dashboard later renders this data without escaping

**Fix:** Add regex validation for email/phone, max length for all text fields (e.g., name: 100, notes: 500, address: 200).

---

### C6. Service Key Used Where Anon Key Would Suffice
**File:** `api/bookings.js`  
**Severity:** Critical  

`bookings.js` uses `SUPABASE_SERVICE_KEY` which bypasses RLS entirely. Since the RLS policy already allows public inserts (`WITH CHECK (true)`), the anon key would suffice for inserts. The service key is necessary for the webhook to update bookings, but over-using it increases blast radius if env vars leak.

**Fix:** Use anon key for bookings.js insert; reserve service key only for webhook updates.

---

## 🟠 High Issues

### H1. RLS Policies Are Too Permissive
**File:** `database/schema.sql`  
**Severity:** High  

Current policies:
- `bookings` SELECT: `USING (true)` — **anyone can read ALL booking data** (names, emails, phones, addresses)
- `bookings` UPDATE: `USING (true)` — **anyone can update any booking** (if using anon key)
- `bookings` INSERT: `WITH CHECK (true)` — open inserts (acceptable for public booking)

**Risk:** With the anon key (which is public in browser), anyone can query `SELECT * FROM bookings` via Supabase's PostgREST API and get all customer PII. The anon key is only used server-side here, but if it leaks (or is in client code), all data is exposed.

**Fix:**
- SELECT on bookings: restrict to `status` and date columns only via a view, or require service key
- UPDATE on bookings: restrict to service role only
- Add a `DELETE` policy that denies all deletes

---

### H2. Confirmation Page Doesn't Verify Payment Status
**File:** `public/confirmation.html`  
**Severity:** High  

The confirmation page reads `booking_id` from the URL and displays "Booking Confirmed!" unconditionally. It never verifies the booking is actually confirmed. A user could navigate to `/confirmation.html?booking_id=anything` and see a fake confirmation.

**Fix:** Add a `GET /api/bookings/:id` endpoint. Fetch booking status and only show "Confirmed" if `status === 'confirmed'`. Show "Pending payment" or "Not found" otherwise.

---

### H3. No Email Notifications Implemented
**File:** `api/webhooks/stripe.js` (line ~60)  
**Severity:** High  

The TODO comments are clear: no confirmation email to customer, no notification to Jason. The confirmation page tells customers "You'll receive a confirmation email shortly" — **this is a lie**.

**Impact:** Customers have no proof of booking. Jason doesn't know when bookings come in.

**Fix:** Integrate Resend or SendGrid for customer confirmation email. Send Jason a Telegram notification (he already uses Telegram).

---

### H4. No Machine Assignment Logic
**File:** `api/bookings.js`  
**Severity:** High  

Bookings are created without assigning a specific `machine_id`. The column exists in the schema but is never populated. This means:
- No tracking of which machine goes to which customer
- Availability is count-based (total bookings vs total machines), not per-machine
- If one machine is in maintenance, there's no way to exclude it

**Fix:** Implement machine assignment at booking or confirmation time. Factor `machines.status` into availability calculations.

---

### H5. Duplicate Booking Form on index.html (Formspree vs API)
**File:** `public/index.html`  
**Severity:** High  

The landing page has a booking form that submits to **Formspree** (`https://formspree.io/f/xbdakwad`) — completely separate from the API-based flow on `book.html`. Bookings from index.html:
- Don't go through Stripe payment
- Don't check availability
- Don't create database records
- Different behavior from book.html = confusing

**Fix:** Remove the Formspree form. Replace with a CTA button linking to `book.html`.

---

## 🟡 Medium Issues

### M1. Timezone Handling Issues
**File:** `api/bookings.js`, `api/availability.js`, `public/book.html`  
**Severity:** Medium  

Dates are handled as strings (`YYYY-MM-DD`) which is mostly fine, but:
- `new Date(start_date)` parses in **UTC**, not Eastern time
- `info.date.toISOString().split('T')[0]` can shift dates by a day near midnight
- `new Date().toISOString().split('T')[0]` for "today" is wrong after 7pm ET (next day in UTC)

**Fix:** Use `YYYY-MM-DD` strings without converting to Date objects, or use `toLocaleDateString` with `timeZone: 'America/New_York'`.

---

### M2. No Admin Dashboard
**Severity:** Medium  

No way for Jason to view bookings, cancel/modify them, block dates, manage machines, process refunds, or see revenue. He must use Supabase dashboard directly.

**Fix:** Build a simple password-protected admin page with API endpoints.

---

### M3. FullCalendar Doesn't Re-render Availability on Month Navigation
**File:** `public/book.html`  
**Severity:** Medium  

`dayCellDidMount` fires only when cells are initially mounted. Navigating months may not re-apply availability CSS classes since the callback uses the stale `availableDates` array.

**Fix:** Use `datesSet` callback to reload availability on month change. Use `dayCellClassNames` (reactive) instead of `dayCellDidMount`.

---

### M4. Deposit Described Incorrectly in FAQ
**File:** `public/index.html`  
**Severity:** Medium  

FAQ says: "We place a $300 **hold** on your card (not charged)." But the code actually **charges** $300 as a Checkout line item. This is misleading.

**Fix:** Update FAQ to say "charged and refunded after return" or implement actual authorization holds.

---

### M5. Mobile Navigation Not Functional
**File:** `public/styles.css`, `public/index.html`  
**Severity:** Medium  

Hamburger menu button exists but has no JavaScript handler. On mobile (<968px), nav links are hidden with no way to open them.

**Fix:** Add toggle JavaScript for the mobile menu.

---

### M6. No Loading/Error States for Calendar
**File:** `public/book.html`  
**Severity:** Medium  

If the availability API fails, the calendar shows no useful feedback — all dates appear unavailable with no explanation or retry option.

---

### M7. Duplicate Files at Root and public/
**File:** Root-level `index.html`, `book.html`, `cn.html` vs `public/` versions  
**Severity:** Medium  

Both root and `public/` contain HTML files. Risk of editing the wrong copy and serving stale content.

**Fix:** Delete root-level copies. Serve only from `public/`.

---

### M8. `VERCEL_URL` May Produce Wrong Base URL
**File:** `api/bookings.js`  
**Severity:** Medium  

`VERCEL_URL` on preview deployments returns a unique URL, not the production domain. Stripe success/cancel URLs would redirect to preview URLs instead of production.

**Fix:** Use a hardcoded `BASE_URL` env var set to the production domain.

---

## 🟢 Low Issues

### L1. No SEO Metadata on book.html
Missing Open Graph tags, canonical URL, structured data.

### L2. Hardcoded Pricing in 3 Places
`api/bookings.js`, `api/availability.js`, `public/book.html` — risk of drift.  
**Fix:** Single source of truth (shared config or DB-driven pricing).

### L3. No Favicon
Causes 404s in browser console.

### L4. Copyright Year Hardcoded to 2024
Footer says "© 2024".

### L5. No `robots.txt` or `sitemap.xml`

### L6. No Error Monitoring
Only `console.error`. No Sentry or structured logging. Errors invisible unless checking Vercel logs.

---

## Recommended Priority Order

| Priority | Issue | Effort |
|----------|-------|--------|
| 1 | C2: Race condition (double bookings) | Medium |
| 2 | C4: Pending bookings block availability | Low |
| 3 | C3: Rate limiting | Low-Medium |
| 4 | C1: CORS restriction | Low |
| 5 | C5: Input validation | Low |
| 6 | H5: Remove Formspree form | Low |
| 7 | H1: Fix RLS policies | Low |
| 8 | C6: Use anon key for inserts | Low |
| 9 | H3: Email notifications | Medium |
| 10 | H2: Fix confirmation page | Low |
| 11 | M5: Mobile nav | Low |
| 12 | M2: Admin dashboard | High |

---

## Architecture Notes

**What's Good:**
- Clean separation: static frontend + serverless API
- Proper Stripe webhook signature verification ✅
- Sensible DB schema with indexes, triggers, and RLS enabled
- Multi-language support (EN/CN)
- FullCalendar for visual date selection
- `checkout.session.expired` webhook handling

**Key Architectural Recommendation:**
Consider a **payment-first** approach: don't create the booking record until the Stripe webhook confirms payment. Pass all booking details via Stripe session metadata. This eliminates C2 (race conditions) and C4 (abandoned bookings) in one architectural change.
