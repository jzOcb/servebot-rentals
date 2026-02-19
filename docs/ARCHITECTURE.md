# ServeBot Rentals - V2 System Architecture

## Overview

A complete rental booking system with real-time availability, automated payments, and inventory management.

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Landing    │  │  Calendar   │  │  Booking    │             │
│  │  Page       │  │  Component  │  │  Form       │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │               │               │                       │
└─────────┼───────────────┼───────────────┼───────────────────────┘
          │               │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API LAYER (Vercel Serverless)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ GET         │  │ POST        │  │ POST        │             │
│  │ /api/       │  │ /api/       │  │ /api/       │             │
│  │ availability│  │ bookings    │  │ webhooks/   │             │
│  │             │  │             │  │ stripe      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │               │               │                       │
└─────────┼───────────────┼───────────────┼───────────────────────┘
          │               │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATABASE (Supabase)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  machines   │  │  bookings   │  │  blocked_   │             │
│  │             │  │             │  │  dates      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STRIPE                                      │
│  ┌─────────────┐  ┌─────────────┐                              │
│  │  Checkout   │  │  Webhooks   │                              │
│  │  Session    │  │  (payment   │                              │
│  │             │  │  confirmed) │                              │
│  └─────────────┘  └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### machines
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Machine identifier (e.g., "Machine 1") |
| status | enum | 'active', 'maintenance', 'retired' |
| created_at | timestamp | |

### bookings
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| machine_id | uuid | FK to machines (nullable for auto-assign) |
| customer_name | text | |
| customer_email | text | |
| customer_phone | text | |
| rental_type | enum | 'half_day_weekday', 'full_day_weekday', etc. |
| start_date | date | |
| end_date | date | |
| pickup_delivery | enum | 'pickup', 'delivery' |
| delivery_address | text | Nullable |
| total_amount | integer | In cents |
| deposit_amount | integer | In cents (300_00 = $300) |
| status | enum | 'pending', 'confirmed', 'cancelled', 'completed' |
| stripe_session_id | text | Checkout session ID |
| stripe_payment_intent | text | For refunds |
| notes | text | |
| created_at | timestamp | |
| updated_at | timestamp | |

### blocked_dates
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| date | date | Blocked date |
| machine_id | uuid | FK to machines (null = all machines) |
| reason | text | e.g., "Holiday", "Maintenance" |
| created_at | timestamp | |

## Rental Types & Pricing

| Type | Duration | Weekday | Weekend | Days Occupied |
|------|----------|---------|---------|---------------|
| half_day_weekday | 4 hours | $45 | - | 1 |
| full_day_weekday | 8 hours | $75 | - | 1 |
| half_day_weekend | 4 hours | - | $55 | 1 |
| full_day_weekend | 8 hours | - | $100 | 1 |
| weekend_package | Sat+Sun | - | $175 | 2 |
| weekly | 7 days | $350 | $350 | 7 |

## API Endpoints

### GET /api/availability
Returns available dates for a given rental type.

**Query Params:**
- `start`: Start date (YYYY-MM-DD)
- `end`: End date (YYYY-MM-DD)
- `type`: Rental type

**Response:**
```json
{
  "available_dates": ["2026-02-20", "2026-02-21", ...],
  "machines_available": {
    "2026-02-20": 3,
    "2026-02-21": 2,
    ...
  }
}
```

**Logic:**
1. Get all bookings in date range
2. Get all blocked dates
3. For each date, count available machines (total - booked - blocked)
4. Apply rental type rules:
   - Weekend types: only return Sat/Sun
   - Weekday types: only return Mon-Fri
   - Weekly: only return dates where 7 consecutive days have availability

### POST /api/bookings
Creates a new booking and returns Stripe checkout URL.

**Request Body:**
```json
{
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "customer_phone": "617-555-1234",
  "rental_type": "full_day_weekday",
  "start_date": "2026-02-20",
  "pickup_delivery": "pickup",
  "delivery_address": null,
  "notes": ""
}
```

**Response:**
```json
{
  "booking_id": "uuid",
  "checkout_url": "https://checkout.stripe.com/..."
}
```

**Logic:**
1. Validate availability
2. Calculate total (rental + delivery + deposit)
3. Create booking with status='pending'
4. Create Stripe Checkout session
5. Return checkout URL

### POST /api/webhooks/stripe
Handles Stripe webhook events.

**Events:**
- `checkout.session.completed`: Mark booking as 'confirmed'
- `charge.refunded`: Handle deposit refund

### GET /api/bookings/:id
Get booking details (for confirmation page).

### Admin Endpoints (Future)
- GET /api/admin/bookings - List all bookings
- PATCH /api/admin/bookings/:id - Update booking status
- POST /api/admin/blocked-dates - Block dates

## Frontend Flow

1. **User selects rental type** → Dropdown
2. **Calendar loads available dates** → GET /api/availability
3. **User clicks available date** → Date selected
4. **User fills booking form** → Name, email, phone, pickup/delivery
5. **User clicks "Book Now"** → POST /api/bookings
6. **Redirect to Stripe Checkout** → User pays
7. **Stripe redirects to success page** → Show confirmation
8. **Owner receives notification** → Email + dashboard

## Stripe Integration

### Products to Create
1. Half Day Weekday: $45 + $300 deposit = $345
2. Full Day Weekday: $75 + $300 deposit = $375
3. Half Day Weekend: $55 + $300 deposit = $355
4. Full Day Weekend: $100 + $300 deposit = $400
5. Weekend Package: $175 + $300 deposit = $475
6. Weekly: $350 + $300 deposit = $650
7. Delivery Fee: $25 (add-on)

### Checkout Flow
- Use Stripe Checkout (hosted)
- Line items: Rental + Deposit + Delivery (optional)
- Metadata: booking_id for webhook matching

### Deposit Handling
Option A: Charge full amount, refund $300 after return
Option B: Use Stripe's authorization hold (requires custom integration)

For MVP: Use Option A (simpler)

## File Structure

```
servebot-rentals/
├── index.html              # Landing page
├── cn.html                 # Chinese version
├── book.html               # Booking page with calendar
├── confirmation.html       # Post-payment confirmation
├── styles.css
├── js/
│   ├── calendar.js         # FullCalendar integration
│   └── booking.js          # Booking form logic
├── api/
│   ├── availability.js     # Serverless function
│   ├── bookings.js         # Serverless function
│   └── webhooks/
│       └── stripe.js       # Webhook handler
├── lib/
│   ├── supabase.js         # Database client
│   └── stripe.js           # Stripe client
└── vercel.json             # Routing config
```

## Environment Variables

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_xxx
```

## Development Phases

### Phase 1: Database & API (Day 1)
- [ ] Set up Supabase project
- [ ] Create database tables
- [ ] Implement /api/availability
- [ ] Implement /api/bookings
- [ ] Set up Stripe products

### Phase 2: Frontend Calendar (Day 2)
- [ ] Add FullCalendar.js
- [ ] Connect to availability API
- [ ] Build booking form
- [ ] Stripe Checkout redirect

### Phase 3: Webhooks & Notifications (Day 3)
- [ ] Stripe webhook handler
- [ ] Email notifications (Resend or SendGrid)
- [ ] Confirmation page
- [ ] Error handling

### Phase 4: Polish & Testing (Day 4)
- [ ] Mobile responsiveness
- [ ] Chinese localization
- [ ] End-to-end testing
- [ ] Deploy to production

## Future Enhancements
- Admin dashboard
- SMS notifications
- Google Calendar sync
- Recurring rentals
- Promo codes
